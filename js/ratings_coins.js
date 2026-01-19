import { db, auth } from './firebase-config.js';
import { 
    doc, 
    updateDoc, 
    onSnapshot, 
    runTransaction, 
    serverTimestamp,
    query,
    collection,
    where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/**
 * ၁။ Rider Profile ကို Real-time စောင့်ကြည့်ခြင်း
 */
export function initRiderSync() {
    const user = auth.currentUser;
    if (!user) return;

    const riderRef = doc(db, "riders", user.uid);
    onSnapshot(riderRef, (snap) => {
        if (snap.exists()) {
            const data = snap.data();
            const coinDisplay = document.getElementById('rider-coins');
            if (coinDisplay) coinDisplay.innerText = data.coins || 0;

            const toggle = document.getElementById('online-toggle');
            const label = document.getElementById('status-label');
            if (toggle) {
                toggle.checked = data.isOnline || false;
                if (label) {
                    label.innerText = data.isOnline ? "Online" : "Offline";
                    data.isOnline ? label.classList.add('online') : label.classList.remove('online');
                }
            }
        }
    });

    // အော်ဒါ Complete ဖြစ်မဖြစ် စောင့်ကြည့်သည့် Function ကို စတင်ပတ်ထားမည်
    listenForCoinDeduction(user.uid);
}

/**
 * ၂။ Online/Offline Toggle Function
 */
window.toggleOnlineStatus = async (checkbox) => {
    const user = auth.currentUser;
    if (!user) return;

    const riderRef = doc(db, "riders", user.uid);
    try {
        await updateDoc(riderRef, {
            isOnline: checkbox.checked,
            lastSeen: serverTimestamp()
        });
    } catch (error) {
        console.error("Status Update Error:", error);
        checkbox.checked = !checkbox.checked;
    }
};

/**
 * ၃။ အော်ဒါလက်ခံသည့် Logic (ဒီနေရာမှာ Coin မနှုတ်တော့ပါ)
 * Rider မှာ Coin အနည်းဆုံး ၅၀ ရှိမရှိကိုတော့ Safety အနေနဲ့ စစ်ထားပေးပါတယ်
 */
window.secureAcceptOrder = async (orderId) => {
    const user = auth.currentUser;
    if (!user) return;

    const orderRef = doc(db, "orders", orderId);
    const riderRef = doc(db, "riders", user.uid);

    try {
        await runTransaction(db, async (transaction) => {
            const orderSnap = await transaction.get(orderRef);
            const riderSnap = await transaction.get(riderRef);

            if (!orderSnap.exists()) throw "အော်ဒါရှာမတွေ့ပါ။";
            if (orderSnap.data().status !== "pending") throw "ဤအော်ဒါကို တခြားသူယူသွားပါပြီ။";

            const currentCoins = riderSnap.data().coins || 0;

            // လက်ခံနိုင်ရန် အနည်းဆုံး Coin ၅၀ ရှိရမည့် စည်းကမ်း (မနှုတ်ပါ)
            if (currentCoins < 50) {
                throw "Coin အနည်းဆုံး ၅၀ ရှိမှ လက်ခံနိုင်ပါမည်။ ကျေးဇူးပြု၍ ငွေဖြည့်ပါ။";
            }

            // အော်ဒါ Status ကို Accepted ပြောင်းရုံသာ လုပ်သည်
            transaction.update(orderRef, {
                status: "accepted",
                riderId: user.uid,
                riderName: riderSnap.data().name || "Rider",
                acceptedAt: serverTimestamp(),
                coinDeducted: false // နှုတ်ပြီး/မပြီး မှတ်ထားရန် field အသစ်
            });
        });

        Swal.fire("အောင်မြင်ပါသည်", "အော်ဒါလက်ခံပြီးပါပြီ", "success");
    } catch (error) {
        Swal.fire("မအောင်မြင်ပါ", error, "error");
    }
};

/**
 * ၄။ အော်ဒါပြီးဆုံးမှ Coin နှုတ်မည့် Logic (စောင့်ကြည့်စနစ်)
 */
function listenForCoinDeduction(riderUid) {
    // Rider ရဲ့ အော်ဒါတွေထဲက Status က Completed ဖြစ်ပြီး Coin မနှုတ်ရသေးတာတွေကို စစ်မယ်
    const q = query(
        collection(db, "orders"), 
        where("riderId", "==", riderUid), 
        where("status", "==", "completed"),
        where("coinDeducted", "==", false)
    );

    onSnapshot(q, (snap) => {
        snap.forEach(async (orderDoc) => {
            const orderData = orderDoc.data();
            const orderRef = doc(db, "orders", orderDoc.id);
            const riderRef = doc(db, "riders", riderUid);

            try {
                await runTransaction(db, async (transaction) => {
                    const riderSnap = await transaction.get(riderRef);
                    const currentCoins = riderSnap.data().coins || 0;
                    const deliveryFee = orderData.deliveryFee || 0;

                    // ၁၀% တွက်ချက်ခြင်း
                    let deduction = Math.floor((deliveryFee * 0.1) / 100);
                    if (deduction < 1) deduction = 1;

                    // Coin နှုတ်ခြင်းနှင့် မှတ်တမ်းတင်ခြင်း
                    transaction.update(riderRef, { coins: currentCoins - deduction });
                    transaction.update(orderRef, { coinDeducted: true });
                });
                console.log("Coin deducted for completed order:", orderDoc.id);
            } catch (e) {
                console.error("Coin deduction error:", e);
            }
        });
    });
}
