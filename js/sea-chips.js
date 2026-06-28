// sea-chips.js — исправленная версия
(function() {
  'use strict';

  const CONFIG = {
    STORE_KEY: 'seachips:cart',
    SUPABASE_URL: 'https://yaukapdyrbefzrifqifa.supabase.co',
    SUPABASE_KEY: 'sb_publishable_KbCQKRekMG883j7KYPz9EQ_Wei3_HeH',
    PROMO_KEY: 'SEACHIPS10'
  };

  let products = [];
  let productsLoaded = false;
  let isLoading = false;

  function initSupabase() {
    if (window.supabaseClient) return window.supabaseClient;
    const client = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
    window.supabaseClient = client;
    return client;
  }

  async function loadProductsFromSupabase() {
    if (productsLoaded) {
      console.log('Товары уже загружены, возвращаю кэш');
      return products;
    }
    
    if (isLoading) {
      console.log('Загрузка уже идёт, ждём...');
      return new Promise(resolve => {
        const checkLoaded = setInterval(() => {
          if (productsLoaded) {
            clearInterval(checkLoaded);
            resolve(products);
          }
        }, 100);
      });
    }
    
    isLoading = true;
    console.log('Начинаю загрузку товаров из Supabase...');

    try {
      const client = initSupabase();
      const { data, error } = await client.from('products').select('*');

      if (error) {
        console.error('Ошибка Supabase:', error);
        isLoading = false;
        return [];
      }

      console.log('Получено данных:', data?.length || 0);

      products = data.map(p => ({
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

      productsLoaded = true;
      isLoading = false;
      console.log('Товаров загружено:', products.length);
      
      window.dispatchEvent(new CustomEvent('products:loaded', { detail: products }));
      return products;
    } catch (error) {
      console.error('Ошибка при загрузке:', error);
      isLoading = false;
      return [];
    }
  }

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
  }

  function addToCart(productId, quantity = 1) {
    const product = getProductById(productId);
    if (!product) {
      console.error('Товар не найден:', productId);
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
    showToast(`${product.name} добавлен в корзину`);
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
          <img src="${imageUrl}" alt="${product.name}" onerror="this.src='/images/placeholder.jpg'">
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
    container.querySelectorAll('.add-to-cart').forEach(btn => {
      btn.removeEventListener('click', btn._handler);
      btn._handler = () => addToCart(btn.dataset.id, 1);
      btn.addEventListener('click', btn._handler);
    });
  }

  function showToast(message, duration = 3000) {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e2a2e;color:white;padding:12px 24px;border-radius:999px;font-size:14px;z-index:1000;opacity:0;transition:opacity 0.2s;pointer-events:none;';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    setTimeout(() => { toast.style.opacity = '0'; }, duration);
  }

  function getQueryParam(param) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
  }

  // Публичное API
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
    showToast,
    getQueryParam,
    PROMO_KEY: CONFIG.PROMO_KEY
  };

  console.log('SeaChips модуль загружен');
})();