import { db } from './firebase-config.js';
import { doc, onSnapshot, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const params = new URLSearchParams(window.location.search);
const orderId = params.get('id');

if (orderId) {
    onSnapshot(doc(db, "orders", orderId), (docSnap) => {
        const data = docSnap.data();
        
        // Progress Bar Logic
        const steps = ["pending", "accepted", "on_the_way", "arrived"];
        steps.forEach((step, idx) => {
            const el = document.getElementById(`step-${idx + 1}`);
            if (steps.indexOf(data.status) >= idx || data.status === "completed") el.classList.add('active');
        });

        // Detail ပြသခြင်း
        document.getElementById('status-title').innerText = `အခြေအနေ: ${data.status.toUpperCase()}`;
        document.getElementById('item-detail').innerHTML = `
            📦 <b>ပစ္စည်း:</b> ${data.item} (${data.weight}kg)<br>
            💰 <b>တန်ဖိုး:</b> ${data.itemValue} KS | 💵 <b>ပို့ခ:</b> ${data.deliveryFee} KS<br>
            🚴 <b>Rider:</b> ${data.riderName || 'ရှာဖွေနေဆဲ'}<br>
            📍 <b>ပို့ရမည့်နေရာ:</b> ${data.dropoff.address}
        `;

        // Confirmation UI (for tomorrow orders)
        const confirmBox = document.getElementById('confirmation-ui');
        if (data.status === "pending_confirmation") {
            confirmBox.style.display = "block";
            confirmBox.innerHTML = `<p>Rider <b>${data.tempRiderName}</b> က မနက်ဖြန်မှ လာယူပါမည်။</p>
                <button onclick="respond(true)">Accept</button> <button onclick="respond(false)">Reject</button>`;
        } else { confirmBox.style.display = "none"; }
    });
}

window.respond = async (isAccepted) => {
    const orderRef = doc(db, "orders", orderId);
    if (isAccepted) {
        // Customer accept လုပ်လျှင် Rider ကို အတည်ပြုပေးလိုက်သည်
        const snap = await getDocs(query(collection(db, "orders"), where("__name__", "==", orderId)));
        const d = snap.docs[0].data();
        await updateDoc(orderRef, { status: "accepted", riderId: d.tempRiderId, riderName: d.tempRiderName, acceptedAt: serverTimestamp() });
    } else {
        await updateDoc(orderRef, { status: "pending", tempRiderId: null, tempRiderName: null });
    }
};
