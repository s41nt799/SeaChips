// sea-chips.js — с бейджем и кнопкой-счётчиком
(function() {
  'use strict';

  const CONFIG = {
    STORE_KEY: 'seachips:cart',
    CACHE_KEY: 'seachips:products',
    CACHE_TIME_KEY: 'seachips:products_time',
    CACHE_TTL: 3600000, // 1 час кеширования
    SUPABASE_URL: 'https://yaukapdyrbefzrifqifa.supabase.co',
    SUPABASE_KEY: 'sb_publishable_KbCQKRekMG883j7KYPz9EQ_Wei3_HeH',
    PROMO_KEY: 'SEACHIPS10'
  };

  let products = [];
  let productsLoaded = false;
  let isLoading = false;
  let loadPromise = null;

  function initSupabase() {
    if (window.supabaseClient) return window.supabaseClient;
    try {
      const client = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
      window.supabaseClient = client;
      return client;
    } catch (e) {
      console.warn('⚠️ Supabase не инициализирован, использую кеш');
      return null;
    }
  }

  // ========== ЗАГРУЗКА ТОВАРОВ С КЕШИРОВАНИЕМ ==========
  function loadProductsFromSupabase(force = false) {
    if (loadPromise) return loadPromise;

    loadPromise = new Promise(async (resolve) => {
      if (productsLoaded && !force) {
        console.log('📦 Из памяти:', products.length);
        resolve(products);
        return;
      }

      if (!force) {
        const cached = localStorage.getItem(CONFIG.CACHE_KEY);
        const cachedTime = localStorage.getItem(CONFIG.CACHE_TIME_KEY);
        
        if (cached && cachedTime) {
          const age = Date.now() - parseInt(cachedTime);
          if (age < CONFIG.CACHE_TTL) {
            try {
              const parsed = JSON.parse(cached);
              if (parsed && parsed.length) {
                console.log('📦 Из кеша:', parsed.length, 'товаров');
                products = parsed;
                productsLoaded = true;
                resolve(products);
                loadPromise = null;
                return;
              }
            } catch (e) {}
          }
        }
      }

      if (isLoading) {
        const waitForLoad = setInterval(() => {
          if (!isLoading) {
            clearInterval(waitForLoad);
            resolve(products);
            loadPromise = null;
          }
        }, 50);
        return;
      }

      isLoading = true;
      console.log('🌊 Загрузка из Supabase...');

      try {
        const client = initSupabase();
        if (!client) {
          isLoading = false;
          loadPromise = null;
          resolve([]);
          return;
        }

        const { data, error } = await client.from('products').select('*');
        if (error) throw error;

        products = (data || []).map(p => ({
          id: p.id,
          article_number: p.article_number,
          name: p.name || 'Без названия',
          price: p.price || 0,
          description: p.description || 'Хрустящие чипсы из морской капусты',
          weight: p.weight || '90 г',
          image: p.image || '/images/placeholder.jpg',
          flavor: p.flavor || '',
          format: p.format || 'single',
          tags: Array.isArray(p.tags) ? p.tags : [],
          props: Array.isArray(p.props) ? p.props : [],
          in_stock: p.in_stock !== false
        }));

        try {
          localStorage.setItem(CONFIG.CACHE_KEY, JSON.stringify(products));
          localStorage.setItem(CONFIG.CACHE_TIME_KEY, String(Date.now()));
        } catch (e) {}

        productsLoaded = true;
        console.log('✅ Загружено:', products.length, 'товаров');
        
        window.dispatchEvent(new CustomEvent('products:loaded', { detail: products }));
        resolve(products);
      } catch (error) {
        console.warn('⚠️ Ошибка загрузки, использую кеш если есть');
        const cached = localStorage.getItem(CONFIG.CACHE_KEY);
        if (cached) {
          try {
            products = JSON.parse(cached);
            productsLoaded = true;
            console.log('📦 Экстренный кеш:', products.length);
            resolve(products);
          } catch (e) {
            resolve([]);
          }
        } else {
          resolve([]);
        }
      } finally {
        isLoading = false;
        loadPromise = null;
      }
    });

    return loadPromise;
  }

  // ========== КОРЗИНА ==========
  function getCart() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG.STORE_KEY)) || [];
    } catch {
      return [];
    }
  }

  function saveCart(cart) {
    localStorage.setItem(CONFIG.STORE_KEY, JSON.stringify(cart));
    window.dispatchEvent(new CustomEvent('cart:updated'));
    updateBadge();
  }

  function addToCart(productId, quantity = 1) {
    const product = getProductById(productId);
    if (!product) {
      showToast('Товар не найден');
      return;
    }

    const cart = getCart();
    const existing = cart.find(item => item.id === productId);

    if (existing) {
      existing.qty += quantity;
    } else {
      cart.push({
        id: productId,
        name: product.name,
        price: product.price,
        image: product.image,
        qty: quantity
      });
    }

    saveCart(cart);
    showToast(`${product.name} +${quantity} в корзине`);
    
    // Обновляем все кнопки на странице
    document.querySelectorAll('.product-card').forEach(card => {
      const btn = card.querySelector('.add-to-cart, .qty-control');
      if (btn) {
        const id = card.dataset.id;
        renderCartButton(id, card);
      }
    });
  }

  function updateQty(productId, quantity) {
    const cart = getCart();
    const item = cart.find(i => i.id === productId);
    if (item) {
      item.qty = Math.max(0, quantity);
      if (item.qty === 0) {
        removeFromCart(productId);
      } else {
        saveCart(cart);
      }
    }
  }

  function removeFromCart(productId) {
    const cart = getCart().filter(item => item.id !== productId);
    saveCart(cart);
    // Обновляем кнопку
    document.querySelectorAll(`.product-card[data-id="${productId}"]`).forEach(card => {
      renderCartButton(productId, card);
    });
  }

  function clearCart() {
    saveCart([]);
  }

  function getCartCount() {
    return getCart().reduce((sum, item) => sum + item.qty, 0);
  }

  function getCartTotal() {
    return getCart().reduce((sum, item) => sum + (item.price * item.qty), 0);
  }

  function getProductById(id) {
    return products.find(p => p.id === id);
  }

  function getAllProducts() {
    return products;
  }

  function formatPrice(price) {
    return price.toLocaleString('ru-RU') + ' ₽';
  }

  // ========== БЕЙДЖ КОРЗИНЫ ==========
  function updateBadge() {
    const badge = document.querySelector('.cart-badge');
    if (!badge) return;

    const count = getCartCount();
    badge.textContent = count;

    if (count > 0) {
      badge.classList.remove('cart-badge--hidden');
    } else {
      badge.classList.add('cart-badge--hidden');
    }

    // Анимация "прыжок"
    badge.style.transform = 'scale(1.4)';
    setTimeout(() => {
      badge.style.transform = 'scale(1)';
    }, 200);
  }

  // ========== КНОПКА-СЧЁТЧИК ==========
  function renderCartButton(productId, container) {
    if (!container) return;
    
    const cart = getCart();
    const item = cart.find(i => i.id === productId);
    const qty = item ? item.qty : 0;

    // Ищем существующую кнопку
    let btn = container.querySelector('.add-to-cart, .qty-control');
    if (!btn) {
      // Если кнопки нет — выходим
      return;
    }

    // Если товара нет в корзине — показываем "В корзину"
    if (qty === 0) {
      btn.className = 'btn btn-primary btn-sm add-to-cart';
      btn.textContent = 'В корзину';
      btn.dataset.id = productId;
      btn._handler = () => addToCart(productId, 1);
      btn.removeEventListener('click', btn._oldHandler);
      btn.addEventListener('click', btn._handler);
      btn._oldHandler = btn._handler;
      return;
    }

    // Если товар в корзине есть — показываем счётчик
    btn.className = 'btn btn-outline btn-sm qty-control';
    btn.innerHTML = `
      <button class="qty-btn qty-minus" data-id="${productId}">−</button>
      <span class="qty-value">${qty}</span>
      <button class="qty-btn qty-plus" data-id="${productId}">+</button>
    `;

    // Назначаем обработчики
    const minus = btn.querySelector('.qty-minus');
    const plus = btn.querySelector('.qty-plus');

    minus.addEventListener('click', function(e) {
      e.stopPropagation();
      const id = this.dataset.id;
      const item = getCart().find(i => i.id === id);
      if (item && item.qty > 1) {
        updateQty(id, item.qty - 1);
      } else {
        removeFromCart(id);
      }
      // Перерисовываем кнопку
      renderCartButton(id, container);
      updateBadge();
    });

    plus.addEventListener('click', function(e) {
      e.stopPropagation();
      const id = this.dataset.id;
      addToCart(id, 1);
      renderCartButton(id, container);
      updateBadge();
    });
  }

  // ========== РЕНДЕР КАРТОЧКИ ==========
  function renderProductCard(product) {
    if (!product) return '';
    
    const imageUrl = product.image || '/images/placeholder.jpg';
    const description = product.description || '';
    const weight = product.weight || '90 г';
    const tags = product.tags || [];
    
    let tagsHtml = '';
    if (tags.includes('hit')) tagsHtml += '<span class="badge badge-hit">Хит</span>';
    if (tags.includes('vegan')) tagsHtml += '<span class="badge badge-vegan">Vegan</span>';
    
    return `
      <div class="product-card" data-id="${product.id}">
        <div class="product-card__image">
          <img src="${imageUrl}" 
               alt="${product.name}" 
               loading="lazy" 
               width="300" 
               height="300"
               decoding="async"
               onerror="this.src='/images/placeholder.jpg'">
          <div class="product-badges">${tagsHtml}</div>
        </div>
        <div class="product-card__content">
          <h3 class="product-card__title">${product.name}</h3>
          ${description ? `<p class="product-card__description">${description.substring(0, 80)}${description.length > 80 ? '…' : ''}</p>` : ''}
          <div class="product-card__meta">
            <span class="product-card__weight">${weight}</span>
            <span class="product-card__flavor">${product.flavor || ''}</span>
          </div>
          <div class="product-card__footer">
            <span class="product-card__price">${formatPrice(product.price)}</span>
            <button class="btn btn-primary btn-sm add-to-cart" data-id="${product.id}">В корзину</button>
          </div>
        </div>
      </div>
    `;
  }

  function bindAddToCartButtons(container) {
    if (!container) return;
    
    // Сначала рендерим все кнопки как счётчики
    container.querySelectorAll('.product-card').forEach(card => {
      const id = card.dataset.id;
      const btn = card.querySelector('.add-to-cart, .qty-control');
      if (btn) {
        renderCartButton(id, card);
      }
    });
  }

  // ========== TOAST ==========
  function showToast(message, duration = 3000) {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e2a2e;color:white;padding:12px 24px;border-radius:999px;font-size:14px;z-index:1000;opacity:0;transition:opacity 0.2s;pointer-events:none;font-family:sans-serif;';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    clearTimeout(toast._hide);
    toast._hide = setTimeout(() => { toast.style.opacity = '0'; }, duration);
  }

  function getQueryParam(param) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
  }

  // ========== ПУБЛИЧНОЕ API ==========
  window.SeaChips = {
    get products() { return products; },
    get productsLoaded() { return productsLoaded; },
    loadProducts: loadProductsFromSupabase,
    getProductById,
    getAllProducts,
    getCart,
    addToCart,
    updateQty,
    removeFromCart,
    clearCart,
    getCartCount,
    getCartTotal,
    formatPrice,
    renderProductCard,
    bindAddToCartButtons,
    renderCartButton,
    updateBadge,
    showToast,
    getQueryParam,
    PROMO_KEY: CONFIG.PROMO_KEY
  };

  // Инициализация бейджа при загрузке
  document.addEventListener('DOMContentLoaded', function() {
    updateBadge();
  });

  // Обновление бейджа при изменении корзины
  window.addEventListener('cart:updated', function() {
    updateBadge();
    // Обновляем все кнопки на странице
    document.querySelectorAll('.product-card').forEach(card => {
      const id = card.dataset.id;
      renderCartButton(id, card);
    });
  });

  console.log('✅ SeaChips модуль загружен (с бейджем и счётчиком)');
})();