// js/telegram.js

const BOT_TOKEN = '8338800196:AAGzQ8vzPitosrIslU6XyafXgvGqzPCjdos'; 

// Public Channel ရဲ့ ID ကို -100 နဲ့စပြီး ထည့်ပေးပါ
// ဥပမာ -1001234567890
const CHANNEL_ID = '-1003650980076'; 

export const notifyTelegram = async (message) => {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHANNEL_ID, 
                text: message,
                parse_mode: 'HTML'
            })
        });
        
        return await response.json();
    } catch (error) {
        console.error("Telegram Notification Error:", error);
    }
};
