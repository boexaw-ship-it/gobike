import { db, auth } from './firebase-config.js';
import { 
    collection, addDoc, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { notifyTelegram } from './telegram.js';

// --- ၁။ Map Setup ---
const map = L.map('map', { zoomControl: false }).setView([16.8661, 96.1951], 12); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let pickupMarker, dropoffMarker;
let pickupCoords = null;
let dropoffCoords = null;

// --- ၂။ Sync Dropdown Options ---
const pickupSelect = document.getElementById('pickup-township');
const dropoffSelect = document.getElementById('dropoff-township');
dropoffSelect.innerHTML = pickupSelect.innerHTML; // Township list ကို ကူးယူခြင်း

// --- ၃။ Township Change & Map Update ---
function updateLocation(type) {
    const select = document.getElementById(`${type}-township`);
    const option = select.options[select.selectedIndex];
    
    if (!option.value) return;

    const lat = parseFloat(option.getAttribute('data-lat'));
    const lng = parseFloat(option.getAttribute('data-lng'));

    if (type === 'pickup') {
        pickupCoords = { lat, lng };
        if (pickupMarker) map.removeLayer(pickupMarker);
        pickupMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
    } else {
        dropoffCoords = { lat, lng };
        if (dropoffMarker) map.removeLayer(dropoffMarker);
        dropoffMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
    }

    map.flyTo([lat, lng], 15);
    calculatePrice();
}

pickupSelect.onchange = () => updateLocation('pickup');
dropoffSelect.onchange = () => updateLocation('dropoff');

// --- ၄။ Auto Pricing Logic (အလေးချိန် နှင့် တန်ဖိုးပါ ထည့်တွက်သည်) ---
function calculatePrice() {
    if (pickupCoords && dropoffCoords) {
        // အကွာအဝေးတွက်ခြင်း
        const p1 = L.latLng(pickupCoords.lat, pickupCoords.lng);
        const p2 = L.latLng(dropoffCoords.lat, dropoffCoords.lng);
        const dist = (p1.distanceTo(p2) / 1000).toFixed(2); // km
        
        // Input တန်ဖိုးများယူခြင်း
        const weight = parseFloat(document.getElementById('item-weight').value) || 0;
        const itemValue = parseFloat(document.getElementById('item-value').value) || 0;

        // --- ဈေးနှုန်းသတ်မှတ်ချက် ---
        let baseFee = 1500; // အခြေခံဈေး
        let distanceFee = dist * 500; // ၁ ကီလိုမီတာ ၅၀၀ ကျပ်
        let weightExtra = 0;
        let insuranceFee = 0;

        // အလေးချိန် ၅ ကီလိုထက်ကျော်လျှင် ၁ ကီလို ၂၀၀ ကျပ်နှုန်းပေါင်းမည်
        if (weight > 5) {
            weightExtra = (weight - 5) * 200;
        }

        // ပစ္စည်းတန်ဖိုး ၅ သောင်းထက်ကျော်ပါက ၁% အာမခံကြေးယူမည်
        if (itemValue > 50000) {
            insuranceFee = itemValue * 0.01; 
        }

        const total = Math.round(baseFee + distanceFee + weightExtra + insuranceFee);
        
        // Button ပေါ်တွင် ဈေးနှုန်းကို တိုက်ရိုက်ပြောင်းခြင်း
        document.getElementById('placeOrderBtn').innerText = `ORDER NOW - ${total.toLocaleString()} KS (${dist} km)`;
        
        return { dist, total, insuranceFee, weightExtra };
    }
}

// Input ရိုက်တိုင်း ဈေးနှုန်းချက်ချင်းပြောင်းရန်
document.getElementById('item-weight').oninput = calculatePrice;
document.getElementById('item-value').oninput = calculatePrice;

// --- ၅။ Submit Order ---
document.getElementById('placeOrderBtn').onclick = async () => {
    const feeInfo = calculatePrice();
    const item = document.getElementById('item-detail').value;
    const phone = document.getElementById('receiver-phone').value;
    const payment = document.getElementById('payment-method').value;
    const weight = document.getElementById('item-weight').value;
    const itemValue = document.getElementById('item-value').value;

    if (!feeInfo || !item || !phone || !weight) {
        alert("ကျေးဇူးပြု၍ အချက်အလက်များကို ပြည့်စုံအောင် ဖြည့်ပေးပါခင်ဗျာ။");
        return;
    }

    try {
        const pTown = pickupSelect.options[pickupSelect.selectedIndex].text;
        const dTown = dropoffSelect.options[dropoffSelect.selectedIndex].text;
        const pAddr = document.getElementById('pickup-address').value;
        const dAddr = document.getElementById('dropoff-address').value;

        const orderData = {
            userId: auth.currentUser?.uid || "anonymous",
            pickup: { ...pickupCoords, address: `${pTown}, ${pAddr}` },
            dropoff: { ...dropoffCoords, address: `${dTown}, ${dAddr}` },
            item: item,
            weight: weight + " kg",
            itemValue: itemValue + " KS",
            phone: phone,
            paymentMethod: payment === "COD" ? "Cash on Delivery (ပို့ခအိမ်ရောက်ချေ)" : "Cash at Pickup (ပို့ခကြိုပေး)",
            deliveryFee: feeInfo.total,
            status: "pending",
            createdAt: serverTimestamp()
        };

        // ၁။ Firebase သို့ အော်ဒါပို့ခြင်း
        await addDoc(collection(db, "orders"), orderData);
        
        // ၂။ Telegram သို့ အချက်အလက်စုံလင်စွာ ပို့ခြင်း
        const msg = `📦 <b>New Order Received!</b>\n` +
                    `--------------------------\n` +
                    `📝 ပစ္စည်း: <b>${item}</b>\n` +
                    `⚖️ အလေးချိန်: ${weight} kg\n` +
                    `💰 ပစ္စည်းတန်ဖိုး: ${itemValue} KS\n` +
                    `--------------------------\n` +
                    `💵 <b>စုစုပေါင်းပို့ခ: ${feeInfo.total.toLocaleString()} KS</b>\n` +
                    `💳 ငွေပေးချေမှု: ${orderData.paymentMethod}\n` +
                    `📞 ဖုန်း: ${phone}\n\n` +
                    `📍 ယူရန်: ${orderData.pickup.address}\n` +
                    `🏁 ပို့ရန်: ${orderData.dropoff.address}\n\n` +
                    `⌛ <i>Rider များ အမြန်ဆုံးလက်ခံပေးပါရန်!</i>`;

        await notifyTelegram(msg);

        alert("Order အောင်မြင်စွာ တင်ပြီးပါပြီ။ Telegram Messenger သို့ အကြောင်းကြားစာ ပို့လိုက်ပါပြီ။");
        location.reload();

    } catch (e) {
        console.error(e);
        alert("Error: " + e.message);
    }
};
