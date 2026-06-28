/**
 * Sea Chips — cart v2 / checkout v2: расчёты, промокоды, доставка
 */
(function () {
  'use strict';

  var PROMO_STORE_KEY = 'seachips:promo';
  var DELIVERY_STORE_KEY = 'seachips:delivery';
  var FREE_DELIVERY_FROM = 1500;
  var PROMO_PERCENT = 10;

  var DELIVERY_PRICES = {
    courier: { price: 299, label: 'Курьером', eta: 'Завтра, 10:00–22:00' },
    pickup: { price: 149, label: 'Пункт выдачи', eta: '1–2 дня' },
    express: { price: 499, label: 'Экспресс', eta: 'Сегодня, 2–4 часа' }
  };

  function getPromoApplied() {
    try {
      return localStorage.getItem(PROMO_STORE_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function setPromoApplied(applied) {
    try {
      if (applied) {
        localStorage.setItem(PROMO_STORE_KEY, '1');
      } else {
        localStorage.removeItem(PROMO_STORE_KEY);
      }
    } catch (_) {}
    window.dispatchEvent(new CustomEvent('cart:promo-changed'));
  }

  function getDeliveryType() {
    try {
      return localStorage.getItem(DELIVERY_STORE_KEY) || 'courier';
    } catch (_) {
      return 'courier';
    }
  }

  function setDeliveryType(type) {
    try {
      localStorage.setItem(DELIVERY_STORE_KEY, type);
    } catch (_) {}
    window.dispatchEvent(new CustomEvent('cart:delivery-changed'));
  }

  /** Проверка промокода — возвращает { ok, message } */
  function validatePromoCode(code) {
    var normalized = (code || '').trim().toUpperCase();
    if (!normalized) {
      return { ok: false, message: 'Введите промокод' };
    }
    if (normalized === window.SeaChips.PROMO_KEY || normalized === 'SEACHIPS10') {
      return { ok: true, message: 'Скидка 10% применена' };
    }
    return { ok: false, message: 'Промокод не найден или истёк' };
  }

  /** Полный расчёт заказа */
  function calculateOrder() {
    var subtotal = window.SeaChips.getCartTotal();
    var count = window.SeaChips.getCartCount();
    var promoApplied = getPromoApplied();
    var discount = promoApplied ? Math.round(subtotal * PROMO_PERCENT / 100) : 0;
    var afterDiscount = subtotal - discount;
    var deliveryType = getDeliveryType();
    var deliveryInfo = DELIVERY_PRICES[deliveryType] || DELIVERY_PRICES.courier;
    var delivery = deliveryInfo.price;

    /* Бесплатная доставка: курьер и ПВЗ от порога, экспресс всегда платный */
    if (afterDiscount >= FREE_DELIVERY_FROM && deliveryType !== 'express') {
      delivery = 0;
    }

    var total = afterDiscount + delivery;
    var freeDeliveryRemaining = Math.max(0, FREE_DELIVERY_FROM - afterDiscount);
    var freeDeliveryReached = afterDiscount >= FREE_DELIVERY_FROM;

    return {
      subtotal: subtotal,
      count: count,
      discount: discount,
      discountPercent: promoApplied ? PROMO_PERCENT : 0,
      promoApplied: promoApplied,
      delivery: delivery,
      deliveryType: deliveryType,
      deliveryLabel: deliveryInfo.label,
      deliveryEta: deliveryInfo.eta,
      total: total,
      freeDeliveryFrom: FREE_DELIVERY_FROM,
      freeDeliveryRemaining: freeDeliveryRemaining,
      freeDeliveryReached: freeDeliveryReached
    };
  }

  /** Форматирование телефона +7 (XXX) XXX-XX-XX */
  function formatPhoneInput(value) {
    var v = value.replace(/\D/g, '');
    if (v.startsWith('8')) v = '7' + v.slice(1);
    if (v.length && !v.startsWith('7')) v = '7' + v;
    var formatted = '+7';
    if (v.length > 1) formatted += ' (' + v.slice(1, 4);
    if (v.length >= 4) formatted += ') ' + v.slice(4, 7);
    if (v.length >= 7) formatted += '-' + v.slice(7, 9);
    if (v.length >= 9) formatted += '-' + v.slice(9, 11);
    return formatted;
  }

  function isValidPhone(phone) {
    return phone.replace(/\D/g, '').length >= 11;
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  /** Рендер строки итого в DOM-контейнер */
  function renderSummaryRows(container, order) {
    if (!container) return;
    container.innerHTML =
      '<div class="summary-line">' +
        '<span>Товары (' + order.count + ')</span>' +
        '<span>' + window.SeaChips.formatPrice(order.subtotal) + '</span>' +
      '</div>' +
      (order.discount
        ? '<div class="summary-line summary-line--savings">' +
            '<span>Скидка <em>−' + order.discountPercent + '%</em></span>' +
            '<span class="summary-value--green">−' + window.SeaChips.formatPrice(order.discount) + '</span>' +
          '</div>'
        : '<div class="summary-line summary-line--muted">' +
            '<span>Скидка</span><span>0 ₽</span>' +
          '</div>') +
      '<div class="summary-line">' +
        '<span>Доставка</span>' +
        '<span>' + (order.delivery ? window.SeaChips.formatPrice(order.delivery) : 'Бесплатно') + '</span>' +
      '</div>' +
      '<div class="summary-line summary-line--total">' +
        '<span>К оплате</span>' +
        '<span id="summary-total-value">' + window.SeaChips.formatPrice(order.total) + '</span>' +
      '</div>';
  }

  /** Прогресс-бар бесплатной доставки */
  function renderFreeDeliveryBar(container, order) {
    if (!container) return;
    if (!order.count) {
      container.style.display = 'none';
      return;
    }
    container.style.display = 'block';

    if (order.freeDeliveryReached) {
      container.innerHTML =
        '<div class="free-delivery-bar free-delivery-bar--done">' +
          '<div class="free-delivery-bar__icon">🎉</div>' +
          '<div class="free-delivery-bar__text">' +
            '<strong>Бесплатная доставка доступна</strong>' +
            '<span>Курьер и пункт выдачи — 0 ₽</span>' +
          '</div>' +
        '</div>';
      return;
    }

    var progress = Math.min(100, (order.subtotal - order.discount) / order.freeDeliveryFrom * 100);
    container.innerHTML =
      '<div class="free-delivery-bar">' +
        '<div class="free-delivery-bar__head">' +
          '<span>До бесплатной доставки осталось <strong>' +
            window.SeaChips.formatPrice(order.freeDeliveryRemaining) +
          '</strong></span>' +
        '</div>' +
        '<div class="free-delivery-bar__track">' +
          '<div class="free-delivery-bar__fill" style="width:' + progress + '%"></div>' +
        '</div>' +
      '</div>';
  }

  window.SeaChipsCart = {
    FREE_DELIVERY_FROM: FREE_DELIVERY_FROM,
    DELIVERY_PRICES: DELIVERY_PRICES,
    getPromoApplied: getPromoApplied,
    setPromoApplied: setPromoApplied,
    getDeliveryType: getDeliveryType,
    setDeliveryType: setDeliveryType,
    validatePromoCode: validatePromoCode,
    calculateOrder: calculateOrder,
    formatPhoneInput: formatPhoneInput,
    isValidPhone: isValidPhone,
    isValidEmail: isValidEmail,
    renderSummaryRows: renderSummaryRows,
    renderFreeDeliveryBar: renderFreeDeliveryBar
  };
})();
