/**
 * Sea Chips — store layer: заказы, upsell, email capture, checkout hook
 */
(function () {
  'use strict';

  var ORDERS_KEY = 'seachips:orders';
  var LAST_ORDER_KEY = 'seachips:last-order';
  var CART_EMAIL_KEY = 'seachips:cart-email';
  var CART_SNAPSHOT_KEY = 'seachips:cart-snapshot';
  var CART_SAVED_AT_KEY = 'seachips:cart-saved-at';

  /* ——— Order persistence ——— */

  function generateOrderId() {
    var d = new Date();
    var date = d.getFullYear().toString() +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0');
    var rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return 'SC-' + date + '-' + rand;
  }

  function getOrders() {
    try {
      return JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]');
    } catch (_) {
      return [];
    }
  }

  function saveOrder(order) {
    var orders = getOrders();
    orders.unshift(order);
    try {
      localStorage.setItem(ORDERS_KEY, JSON.stringify(orders.slice(0, 50)));
      localStorage.setItem(LAST_ORDER_KEY, order.id);
    } catch (_) {}
    window.dispatchEvent(new CustomEvent('order:created', { detail: order }));
    return order;
  }

  function getOrderById(id) {
    return getOrders().find(function (o) { return o.id === id; });
  }

  function getLastOrder() {
    try {
      var id = localStorage.getItem(LAST_ORDER_KEY);
      return id ? getOrderById(id) : null;
    } catch (_) {
      return null;
    }
  }

  /** Сборка заказа из checkout-формы */
  function buildOrderFromCheckout(formData) {
    var cart = window.SeaChips.getCart();
    var calc = window.SeaChipsCart.calculateOrder();
    var items = [];

    cart.forEach(function (item) {
      var p = window.SeaChips.getProductById(item.id);
      if (!p) return;
      items.push({
        id: p.id,
        name: p.name,
        weight: p.weight,
        qty: item.qty,
        price: p.price,
        lineTotal: p.price * item.qty
      });
    });

    return {
      id: generateOrderId(),
      createdAt: new Date().toISOString(),
      status: 'confirmed',
      paymentStatus: 'pending',
      customer: {
        name: formData.name,
        phone: formData.phone,
        email: formData.email
      },
      delivery: {
        type: window.SeaChipsCart.getDeliveryType(),
        label: calc.deliveryLabel,
        address: formData.address || '',
        slot: formData.slot,
        eta: calc.deliveryEta
      },
      payment: {
        method: formData.paymentMethod,
        provider: window.SeaChipsPayment.getActiveProviderId()
      },
      items: items,
      totals: {
        subtotal: calc.subtotal,
        discount: calc.discount,
        discountPercent: calc.discountPercent,
        delivery: calc.delivery,
        total: calc.total
      },
      promoApplied: calc.promoApplied
    };
  }

  /* ——— Cart persistence audit ——— */

  function auditCart() {
    var cart = window.SeaChips.getCart();
    var repaired = [];
    var removed = 0;
    var issues = [];

    cart.forEach(function (item) {
      if (!item || !item.id) {
        removed++;
        issues.push('Пустая позиция удалена');
        return;
      }
      var product = window.SeaChips.getProductById(item.id);
      if (!product) {
        removed++;
        issues.push('Неизвестный товар: ' + item.id);
        return;
      }
      var qty = parseInt(item.qty, 10);
      if (isNaN(qty) || qty < 1) {
        qty = 1;
        issues.push('Исправлено количество для ' + product.name);
      }
      if (qty > 99) {
        qty = 99;
        issues.push('Ограничено количество для ' + product.name);
      }
      repaired.push({ id: item.id, qty: qty });
    });

    if (removed || issues.length) {
      window.SeaChips.saveCart(repaired);
    }

    return {
      ok: issues.length === 0,
      itemCount: repaired.reduce(function (s, i) { return s + i.qty; }, 0),
      issues: issues,
      repaired: removed > 0 || issues.length > 0
    };
  }

  /* ——— Email capture ——— */

  function getSavedEmail() {
    try {
      return localStorage.getItem(CART_EMAIL_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function saveCartWithEmail(email) {
    if (!window.SeaChipsCart.isValidEmail(email)) {
      return { ok: false, message: 'Введите корректный email' };
    }
    var cart = window.SeaChips.getCart();
    if (!cart.length) {
      return { ok: false, message: 'Корзина пуста' };
    }

    try {
      localStorage.setItem(CART_EMAIL_KEY, email.trim().toLowerCase());
      localStorage.setItem(CART_SNAPSHOT_KEY, JSON.stringify({
        cart: cart,
        promo: window.SeaChipsCart.getPromoApplied(),
        delivery: window.SeaChipsCart.getDeliveryType(),
        savedAt: new Date().toISOString()
      }));
      localStorage.setItem(CART_SAVED_AT_KEY, Date.now().toString());
    } catch (_) {
      return { ok: false, message: 'Не удалось сохранить' };
    }

    return { ok: true, message: 'Корзина сохранена — отправим напоминание на ' + email };
  }

  function restoreCartSnapshot() {
    try {
      var raw = localStorage.getItem(CART_SNAPSHOT_KEY);
      if (!raw) return false;
      var snap = JSON.parse(raw);
      if (snap.cart && snap.cart.length) {
        window.SeaChips.saveCart(snap.cart);
        if (snap.promo) window.SeaChipsCart.setPromoApplied(true);
        if (snap.delivery) window.SeaChipsCart.setDeliveryType(snap.delivery);
        return true;
      }
    } catch (_) {}
    return false;
  }

  /* ——— Upsell recommendations ——— */

  function getUpsellProducts(limit) {
    limit = limit || 3;
    var cartIds = window.SeaChips.getCart().map(function (i) { return i.id; });
    var candidates = window.SeaChips.PRODUCTS.filter(function (p) {
      return cartIds.indexOf(p.id) < 0;
    });

    /* Приоритет: мультипаки и хиты */
    candidates.sort(function (a, b) {
      var scoreA = (a.format === 'multi' ? 2 : 0) + (a.tags.indexOf('hit') >= 0 ? 1 : 0);
      var scoreB = (b.format === 'multi' ? 2 : 0) + (b.tags.indexOf('hit') >= 0 ? 1 : 0);
      return scoreB - scoreA;
    });

    return candidates.slice(0, limit);
  }

  function renderUpsellBlock(container) {
    if (!container) return;
    var products = getUpsellProducts(3);
    if (!products.length || !window.SeaChips.getCart().length) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';
    var html =
      '<div class="cart-upsell">' +
        '<div class="cart-upsell__head">' +
          '<h3 class="cart-upsell__title">Добавьте к заказу</h3>' +
          '<p class="cart-upsell__hint">Популярные вкусы — увеличьте выгоду с мультипаком</p>' +
        '</div>' +
        '<div class="cart-upsell__grid">';

    products.forEach(function (p) {
      var badge = p.format === 'multi'
        ? '<span class="cart-upsell__badge">Выгодно</span>'
        : (p.tags.indexOf('hit') >= 0 ? '<span class="cart-upsell__badge cart-upsell__badge--hit">Хит</span>' : '');

      html +=
        '<article class="cart-upsell__card">' +
          badge +
          '<div class="cart-upsell__photo">' +
            '<div class="product-photo"><span class="product-photo-label">' + p.name + '</span></div>' +
          '</div>' +
          '<div class="cart-upsell__body">' +
            '<h4>' + p.name + '</h4>' +
            '<p>' + p.subtitle + '</p>' +
            '<div class="cart-upsell__footer">' +
              '<span class="cart-upsell__price">' + window.SeaChips.formatPrice(p.price) + '</span>' +
              '<button type="button" class="btn btn-secondary btn-sm" data-upsell-add="' + p.id + '">+ Добавить</button>' +
            '</div>' +
          '</div>' +
        '</article>';
    });

    html += '</div></div>';
    container.innerHTML = html;

    container.querySelectorAll('[data-upsell-add]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        window.SeaChips.addToCart(btn.getAttribute('data-upsell-add'));
        window.dispatchEvent(new CustomEvent('cart:upsell-added'));
      });
    });
  }

  /* ——— Email capture block injection ——— */

  function renderEmailCaptureBlock(container) {
    if (!container) return;
    var saved = getSavedEmail();

    container.innerHTML =
      '<div class="email-capture">' +
        '<div class="email-capture__icon">✉</div>' +
        '<div class="email-capture__content">' +
          '<h3 class="email-capture__title">Сохранить корзину</h3>' +
          '<p class="email-capture__hint">Оставьте email — напомним о товарах и пришлём промокод</p>' +
          '<div class="email-capture__row">' +
            '<input type="email" class="form-input" id="cart-email-input" placeholder="your@email.ru" value="' + (saved || '') + '" autocomplete="email" />' +
            '<button type="button" class="btn btn-secondary" id="cart-email-save">Сохранить</button>' +
          '</div>' +
          '<p class="email-capture__status" id="cart-email-status"></p>' +
        '</div>' +
      '</div>';

    var input = document.getElementById('cart-email-input');
    var btn = document.getElementById('cart-email-save');
    var status = document.getElementById('cart-email-status');

    btn.addEventListener('click', function () {
      btn.classList.add('is-loading');
      setTimeout(function () {
        btn.classList.remove('is-loading');
        var result = saveCartWithEmail(input.value);
        status.className = 'email-capture__status ' + (result.ok ? 'is-success' : 'is-error');
        status.textContent = result.message;
        if (result.ok) window.SeaChips.showToast(result.message);
      }, 500);
    });
  }

  /* ——— Checkout hook → order + payment → redirect ——— */

  function initCheckoutHook() {
    var form = document.getElementById('checkout-form');
    if (!form || form.dataset.storeHooked) return;
    form.dataset.storeHooked = '1';

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();

      var nameEl = document.getElementById('name');
      var phoneEl = document.getElementById('phone');
      var emailEl = document.getElementById('email');
      var addressEl = document.getElementById('address');
      var paymentEl = document.querySelector('input[name="payment"]:checked');
      var activeSlot = document.querySelector('.time-slot.active');

      if (!nameEl || !phoneEl || !emailEl) return;

      /* Валидация */
      var valid = true;
      [nameEl, phoneEl, emailEl].forEach(function (el) { el.classList.remove('error'); });

      if (!nameEl.value.trim()) { nameEl.classList.add('error'); valid = false; }
      if (!window.SeaChipsCart.isValidPhone(phoneEl.value)) { phoneEl.classList.add('error'); valid = false; }
      if (!window.SeaChipsCart.isValidEmail(emailEl.value)) { emailEl.classList.add('error'); valid = false; }

      var deliveryType = window.SeaChipsCart.getDeliveryType();
      if (deliveryType !== 'pickup' && addressEl && !addressEl.value.trim()) {
        addressEl.classList.add('error');
        valid = false;
      }

      if (!valid) {
        window.SeaChips.showToast('Заполните обязательные поля');
        return;
      }

      var paymentMethod = paymentEl ? paymentEl.value : 'card';
      if (paymentMethod === 'card') {
        var cardEl = document.getElementById('card-number');
        if (cardEl && cardEl.value.replace(/\s/g, '').length < 16) {
          cardEl.classList.add('error');
          window.SeaChips.showToast('Введите номер карты');
          return;
        }
      }

      var slotMap = { '10-14': '10:00–14:00', '14-18': '14:00–18:00', '18-22': '18:00–22:00' };
      var slotKey = activeSlot ? activeSlot.dataset.slot : '10-14';

      var order = buildOrderFromCheckout({
        name: nameEl.value.trim(),
        phone: phoneEl.value.trim(),
        email: emailEl.value.trim(),
        address: addressEl ? addressEl.value.trim() : '',
        paymentMethod: paymentMethod,
        slot: slotMap[slotKey] || slotKey
      });

      /* Сохраняем email для будущих сессий */
      try {
        localStorage.setItem(CART_EMAIL_KEY, order.customer.email);
      } catch (_) {}

      var payBtn = document.querySelector('[type="submit"].btn-primary, #mobile-action');
      if (payBtn) {
        payBtn.disabled = true;
        payBtn.textContent = 'Обработка…';
      }

      window.SeaChipsPayment.createPayment(order).then(function (result) {
        order.paymentStatus = result.status === 'succeeded' ? 'paid' : 'pending';
        order.payment.paymentId = result.paymentId;
        order.payment.providerName = result.providerName;
        order.status = 'confirmed';

        saveOrder(order);
        /* Очищаем snapshot — заказ завершён */
        try {
          localStorage.removeItem(CART_SNAPSHOT_KEY);
          localStorage.removeItem(CART_SAVED_AT_KEY);
        } catch (_) {}
        window.SeaChips.clearCart();
        window.SeaChipsCart.setPromoApplied(false);

        window.location.href = 'order-success.html?id=' + encodeURIComponent(order.id);
      }).catch(function () {
        if (payBtn) {
          payBtn.disabled = false;
          payBtn.textContent = 'Оплатить';
        }
        window.SeaChips.showToast('Ошибка оплаты — попробуйте снова');
      });
    }, true);
  }

  /* ——— Cart page enhancements ——— */

  function initCartEnhancements() {
    if (!document.getElementById('cart-items')) return;

    /* Upsell — вставляем после списка товаров */
    if (!document.getElementById('cart-upsell-wrap')) {
      var upsellWrap = document.createElement('div');
      upsellWrap.id = 'cart-upsell-wrap';
      var itemsEl = document.getElementById('cart-items');
      itemsEl.parentNode.insertBefore(upsellWrap, itemsEl.nextSibling);
      renderUpsellBlock(upsellWrap);
      window.addEventListener('cart:updated', function () { renderUpsellBlock(upsellWrap); });
      window.addEventListener('cart:upsell-added', function () { renderUpsellBlock(upsellWrap); });
    }

    /* Email capture — перед промокодом */
    if (!document.getElementById('email-capture-wrap')) {
      var emailWrap = document.createElement('div');
      emailWrap.id = 'email-capture-wrap';
      var promoBlock = document.getElementById('promo-block');
      if (promoBlock) {
        promoBlock.parentNode.insertBefore(emailWrap, promoBlock);
        renderEmailCaptureBlock(emailWrap);
      }
    }
  }

  /* ——— Init ——— */

  function shouldRestoreCartSnapshot() {
    var href = location.href;
    if (href.includes('checkout') || href.includes('order-success')) return false;
    return href.includes('cart-v2') || href.includes('catalog') ||
      href.includes('home') || href.includes('product');
  }

  function init() {
    var audit = auditCart();
    if (audit.repaired && audit.issues.length) {
      window.SeaChips.showToast('Корзина восстановлена');
    }

    /* Восстановление сохранённой корзины только на страницах покупок */
    if (!window.SeaChips.getCart().length && shouldRestoreCartSnapshot()) {
      if (restoreCartSnapshot()) {
        var key = 'seachips:restore-toast';
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, '1');
          window.SeaChips.showToast('Корзина восстановлена из сохранения');
        }
      }
    }

    initCheckoutHook();
    initCartEnhancements();

    /* Pre-fill checkout email */
    var emailEl = document.getElementById('email');
    var saved = getSavedEmail();
    if (emailEl && saved && !emailEl.value) {
      emailEl.value = saved;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.SeaChipsStore = {
    generateOrderId: generateOrderId,
    getOrders: getOrders,
    saveOrder: saveOrder,
    getOrderById: getOrderById,
    getLastOrder: getLastOrder,
    buildOrderFromCheckout: buildOrderFromCheckout,
    auditCart: auditCart,
    getSavedEmail: getSavedEmail,
    saveCartWithEmail: saveCartWithEmail,
    restoreCartSnapshot: restoreCartSnapshot,
    getUpsellProducts: getUpsellProducts,
    renderUpsellBlock: renderUpsellBlock,
    renderEmailCaptureBlock: renderEmailCaptureBlock
  };
})();
