// order-service.js — ФИНАЛ
const ORDER_SERVICE = {
  // ========== TELEGRAM НАСТРОЙКИ ==========
  telegram: {
    token: '8995817162:AAFzWvIRn-_xBxXiSYb0uQecquxaI9iRTH8',
    chatId: '8431012952'
  },

  // ========== ОТПРАВКА ЗАКАЗА (МГНОВЕННО) ==========
  async submitOrder(orderData) {
    try {
      console.log('📦 Отправка заказа...', orderData);
      
      // 🔥 1. Сохраняем заказ (это быстро)
      const { data, error } = await window.supabaseClient
        .from('orders')
        .insert([orderData])
        .select()
        .single();
      
      if (error) {
        console.error('Ошибка Supabase:', error);
        throw new Error('Не удалось сохранить заказ: ' + error.message);
      }
      
      console.log('✅ Заказ сохранён в Supabase:', data);
      
      // 🔥 2. Telegram отправляем в фоне (НЕ ЖДЁМ!)
      this.sendTelegramNotification(orderData);
      
      // 🔥 3. Возвращаем заказ сразу, не дожидаясь Telegram
      return data;
      
    } catch (error) {
      console.error('❌ Ошибка при оформлении заказа:', error);
      throw error;
    }
  },

  // ========== TELEGRAM (фоновый, без ожидания) ==========
  async sendTelegramNotification(order) {
    try {
      const message = this.formatOrderMessage(order);
      console.log('📤 Отправка в Telegram (фон)...');
      
      const response = await fetch(
        'https://yaukapdyrbefzrifqifa.supabase.co/functions/v1/send-telegram',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: message })
        }
      );
      
      const result = await response.json();
      
      if (response.ok && result.ok) {
        console.log('✅ Уведомление в Telegram отправлено');
      } else {
        console.error('❌ Ошибка Telegram:', result);
      }
    } catch (error) {
      console.warn('⚠️ Telegram не ответил, но заказ сохранён:', error.message);
    }
  },

  // ========== ФОРМАТИРОВАНИЕ ==========
  formatOrderMessage(order) {
    const itemsList = (order.items || []).map(item => 
      `  • ${item.name} × ${item.qty} = ${item.lineTotal} ₽`
    ).join('\n');
    
    return `
🛍 <b>НОВЫЙ ЗАКАЗ!</b>

👤 <b>Клиент:</b> ${order.customer_name}
📱 <b>Телефон:</b> ${order.customer_phone}
📧 <b>Email:</b> ${order.customer_email || '—'}

📦 <b>Заказ:</b>
${itemsList}

💰 <b>Итого:</b> ${order.total} ₽
🚚 <b>Доставка:</b> ${order.delivery_method}
${order.delivery_address ? `📍 <b>Адрес:</b> ${order.delivery_address}` : ''}
${order.delivery_slot ? `⏰ <b>Время:</b> ${order.delivery_slot}` : ''}
💳 <b>Оплата:</b> ${order.payment_method}

🆔 <b>Заказ #</b> ${order.order_number}
    `.trim();
  },

  // ========== ГЕНЕРАЦИЯ НОМЕРА ==========
  generateOrderNumber() {
    const date = new Date();
    const prefix = 'SC';
    const timestamp = date.getFullYear().toString().slice(-2) +
                      String(date.getMonth() + 1).padStart(2, '0') +
                      String(date.getDate()).padStart(2, '0');
    const random = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    return `${prefix}${timestamp}${random}`;
  }
};

window.OrderService = ORDER_SERVICE;
console.log('✅ OrderService загружен (Telegram в фоне)');