/**
 * Sea Chips — платёжная архитектура
 * Адаптеры: ЮKassa, Т-Банк Эквайринг, Robokassa
 * Прототип: симуляция оплаты с готовой структурой под production API
 */
(function () {
  'use strict';

  var PROVIDER_KEY = 'seachips:payment-provider';
  var DEFAULT_PROVIDER = 'yookassa';

  /**
   * Конфигурация провайдеров — в production значения из env / backend
   */
  var PROVIDERS = {
    yookassa: {
      id: 'yookassa',
      name: 'ЮKassa',
      apiBase: 'https://api.yookassa.ru/v3',
      endpoints: {
        createPayment: '/payments',
        getPayment: '/payments/{id}',
        webhook: '/webhooks/yookassa'
      },
      methods: ['card', 'sbp', 'apple_pay', 'google_pay'],
      currency: 'RUB',
      capture: true
    },
    tbank: {
      id: 'tbank',
      name: 'Т-Банк Эквайринг',
      apiBase: 'https://securepay.tinkoff.ru/v2',
      endpoints: {
        init: '/Init',
        getState: '/GetState',
        confirm: '/Confirm',
        webhook: '/webhooks/tbank'
      },
      methods: ['card', 'sbp', 'apple_pay', 'google_pay'],
      currency: 'RUB'
    },
    robokassa: {
      id: 'robokassa',
      name: 'Robokassa',
      apiBase: 'https://auth.robokassa.ru/Merchant',
      endpoints: {
        index: '/Index.aspx',
        result: '/Result',
        success: '/Success',
        fail: '/Fail'
      },
      methods: ['card', 'sbp'],
      currency: 'RUB'
    }
  };

  /** Маппинг UI-методов checkout → провайдер */
  var METHOD_MAP = {
    card: 'bank_card',
    sbp: 'sbp',
    apple: 'apple_pay',
    google: 'google_pay'
  };

  function getActiveProviderId() {
    try {
      return localStorage.getItem(PROVIDER_KEY) || DEFAULT_PROVIDER;
    } catch (_) {
      return DEFAULT_PROVIDER;
    }
  }

  function setActiveProviderId(id) {
    if (!PROVIDERS[id]) return false;
    try {
      localStorage.setItem(PROVIDER_KEY, id);
      return true;
    } catch (_) {
      return false;
    }
  }

  function getProvider(id) {
    return PROVIDERS[id || getActiveProviderId()];
  }

  /** Построение payload для конкретного провайдера */
  function buildPaymentPayload(order, providerId) {
    var provider = getProvider(providerId);
    var amount = {
      value: (order.totals.total / 100).toFixed(2),
      currency: provider.currency
    };
    /* В прототипе total в рублях — для API переводим в копейки в createPayment */
    amount.value = order.totals.total.toFixed(2);

    var base = {
      orderId: order.id,
      amount: amount,
      description: 'Sea Chips — заказ ' + order.id,
      customer: order.customer,
      metadata: {
        order_id: order.id,
        items_count: order.items.length
      },
      returnUrl: getReturnUrl(order.id),
      failUrl: getFailUrl(order.id)
    };

    if (providerId === 'yookassa') {
      return Object.assign({}, base, {
        confirmation: { type: 'redirect', return_url: base.returnUrl },
        payment_method_data: { type: METHOD_MAP[order.payment.method] || 'bank_card' },
        capture: provider.capture
      });
    }

    if (providerId === 'tbank') {
      return Object.assign({}, base, {
        TerminalKey: 'SEACHIPS_TERMINAL_KEY',
        OrderId: order.id,
        Amount: Math.round(order.totals.total * 100),
        Description: base.description,
        SuccessURL: base.returnUrl,
        FailURL: base.failUrl,
        Receipt: buildReceipt(order)
      });
    }

    if (providerId === 'robokassa') {
      return Object.assign({}, base, {
        MerchantLogin: 'seachips',
        OutSum: order.totals.total.toFixed(2),
        InvId: order.id.replace(/\D/g, '').slice(-8) || Date.now(),
        Description: base.description,
        Culture: 'ru',
        Encoding: 'utf-8'
      });
    }

    return base;
  }

  /** Фискальный чек для Т-Банка */
  function buildReceipt(order) {
    return {
      Email: order.customer.email,
      Phone: order.customer.phone,
      Taxation: 'usn_income',
      Items: order.items.map(function (item) {
        return {
          Name: item.name,
          Price: Math.round(item.price * 100),
          Quantity: item.qty,
          Amount: Math.round(item.lineTotal * 100),
          Tax: 'none',
          PaymentMethod: 'full_payment',
          PaymentObject: 'commodity'
        };
      })
    };
  }

  function getReturnUrl(orderId) {
    var base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
    return base + 'order-success.html?id=' + encodeURIComponent(orderId);
  }

  function getFailUrl(orderId) {
    var base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
    return base + 'checkout-v2.html?payment=failed&order=' + encodeURIComponent(orderId);
  }

  /**
   * Создание платежа — в production: fetch к backend proxy
   * Прототип: симулирует успешную оплату через 800ms
   */
  function createPayment(order, options) {
    options = options || {};
    var providerId = options.provider || getActiveProviderId();
    var provider = getProvider(providerId);
    var payload = buildPaymentPayload(order, providerId);

    return new Promise(function (resolve, reject) {
      /* Production: POST /api/payments/create { provider, payload } */
      setTimeout(function () {
        var paymentId = providerId.toUpperCase().slice(0, 2) +
          '-' + Date.now().toString(36).toUpperCase();

        resolve({
          ok: true,
          provider: providerId,
          providerName: provider.name,
          paymentId: paymentId,
          status: 'succeeded',
          redirectUrl: getReturnUrl(order.id),
          payload: payload,
          simulated: true
        });
      }, options.simulateDelay || 800);
    });
  }

  /** Проверка статуса платежа — для webhook / polling */
  function getPaymentStatus(paymentId, providerId) {
    providerId = providerId || getActiveProviderId();
    return Promise.resolve({
      paymentId: paymentId,
      provider: providerId,
      status: 'succeeded'
    });
  }

  /** Обработка webhook (документация для backend) */
  function handleWebhook(providerId, payload) {
    var provider = getProvider(providerId);
    if (!provider) return { ok: false, error: 'Unknown provider' };

    return {
      ok: true,
      provider: providerId,
      event: payload.event || 'payment.succeeded',
      orderId: payload.metadata && payload.metadata.order_id
    };
  }

  window.SeaChipsPayment = {
    PROVIDERS: PROVIDERS,
    DEFAULT_PROVIDER: DEFAULT_PROVIDER,
    getActiveProviderId: getActiveProviderId,
    setActiveProviderId: setActiveProviderId,
    getProvider: getProvider,
    buildPaymentPayload: buildPaymentPayload,
    createPayment: createPayment,
    getPaymentStatus: getPaymentStatus,
    handleWebhook: handleWebhook,
    getReturnUrl: getReturnUrl
  };
})();
