import { db, auth } from './firebase-config.js';
import { 
    collection, query, where, onSnapshot, doc, updateDoc, setDoc, getDocs, getDoc, serverTimestamp, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { notifyTelegram } from './telegram.js';

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzoqWIjISI8MrzFYu-B7CBldle8xuo-B5jNQtCRsqHLOaLPEPelYX84W5lRXoB9RhL6uw/exec";

// --- ၀။ Alarm Sound Setup ---
const alarmSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
let isSoundAllowed = false;

const soundBtn = document.createElement('button');
soundBtn.innerHTML = "🔔 အသံဖွင့်ရန်";
soundBtn.style = "position:fixed; bottom:85px; right:20px; z-index:3000; padding:10px 18px; background:#ffcc00; color:#000; border:2px solid #1a1a1a; border-radius:50px; font-weight:bold; cursor:pointer;";
document.body.appendChild(soundBtn);
soundBtn.onclick = () => {
    isSoundAllowed = true;
    alarmSound.play().then(() => { soundBtn.style.display = 'none'; }).catch(e => console.log("Sound enabled"));
};

// --- ၁။ Auth & Profile ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        await getRiderData(); 
        startTracking(); 
    } else {
        window.location.href = "../index.html";
    }
});

async function getRiderData() {
    if (!auth.currentUser) return;
    const snap = await getDoc(doc(db, "riders", auth.currentUser.uid));
    if (snap.exists()) {
        const data = snap.data();
        document.getElementById('display-name').innerText = data.name;
        document.getElementById('display-role').innerText = data.role || "Rider";
    }
}

// --- ၂။ Main Tracking Logic ---
function startTracking() {
    if (!auth.currentUser) return;
    const myUid = auth.currentUser.uid;

    // (A) Available Orders (အော်ဒါသစ်များ - ပစ္စည်းဖိုး နှင့် ပို့ခ အစကတည်းက မြင်ရမည်)
    onSnapshot(query(collection(db, "orders"), where("status", "==", "pending")), async (snap) => {
        const container = document.getElementById('available-orders');
        if(!container) return;
        const activeSnap = await getDocs(query(collection(db, "orders"), where("riderId", "==", myUid), where("status", "in", ["accepted", "on_the_way", "arrived"])));
        const isFull = activeSnap.size >= 3;

        container.innerHTML = snap.empty ? "<div class='empty-msg'>အော်ဒါသစ်မရှိသေးပါ</div>" : "";
        snap.forEach(orderDoc => {
            const d = orderDoc.data();
            if (d.lastRejectedRiderId === myUid || d.tempRiderId === myUid) return;
            const id = orderDoc.id;
            const card = document.createElement('div');
            card.className = 'order-card';
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <b style="font-size:1.1rem; color:#fff;">📦 ${d.item} (${d.weight || 0}kg)</b>
                    <div style="text-align:right;">
                        <b style="color:#ffcc00; font-size:1.1rem; display:block;">${(d.deliveryFee || 0).toLocaleString()} KS</b>
                        <small style="color:#00ff00;">Value: ${(d.itemValue || 0).toLocaleString()} KS</small>
                    </div>
                </div>
                <div style="font-size:0.85rem; color:#aaa; margin:10px 0;">
                    📍 <b>PICKUP:</b> ${d.pickup?.address || d.pickupAddress}<br>
                    🏁 <b>DROP:</b> ${d.dropoff?.address || d.dropoffAddress}
                </div>
                <div style="display:flex; gap:10px;">
                    <button class="btn-accept" style="flex:2; background:${isFull ? '#444' : '#ffcc00'}" ${isFull ? 'disabled' : ''} onclick="handleAccept('${id}', 'now')">${isFull ? 'Limit Full' : 'လက်ခံမည်'}</button>
                    <button class="btn-accept" style="flex:1; background:#333; color:#fff;" onclick="handleAccept('${id}', 'tomorrow')">မနက်ဖြန်</button>
                </div>`;
            container.appendChild(card);
        });
        if (!snap.empty && isSoundAllowed) alarmSound.play().catch(e => {});
    });

    // (B) Active Tasks (လက်ရှိပို့ဆောင်နေသော အော်ဒါများ - အချက်အလက်စုံလင်စွာ)
    onSnapshot(query(collection(db, "orders"), where("riderId", "==", myUid)), (snap) => {
        const list = document.getElementById('active-orders-list');
        const activeCountDisplay = document.getElementById('active-count');
        let activeCount = 0;
        list.innerHTML = "";
        snap.forEach(orderDoc => {
            const d = orderDoc.data();
            if (["accepted", "on_the_way", "arrived"].includes(d.status)) {
                activeCount++;
                const id = orderDoc.id;
                let btnText = "🚚 ပစ္စည်းစယူပြီ", nextStatus = "on_the_way";
                if(d.status === "on_the_way") { btnText = "📍 ရောက်ရှိကြောင်းပို့ရန်", nextStatus = "arrived"; }
                if(d.status === "arrived") { btnText = "✅ ပစ္စည်းအပ်နှံပြီး", nextStatus = "completed"; }

                const div = document.createElement('div');
                div.className = 'order-card active-item';
                div.style = "border-left: 5px solid #ffcc00; background:#1a1a1a; padding:15px; margin-bottom:12px; border-radius:10px;";
                div.innerHTML = `
                    <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                        <span style="color:#ffcc00; font-weight:bold; font-size:0.8rem;">STATUS: ${d.status.toUpperCase()}</span>
                        <span style="color:#ff4444; font-weight:bold; cursor:pointer;" onclick="cancelByRider('${id}')">✖ Cancel</span>
                    </div>
                    
                    <div style="background:#222; padding:12px; border-radius:8px; margin-bottom:12px; border:1px solid #333;">
                        <div style="display:flex; justify-content:space-between; border-bottom:1px solid #444; padding-bottom:8px; margin-bottom:8px;">
                             <b style="color:#fff; font-size:1.1rem;">📦 ${d.item} (${d.weight || 0}kg)</b>
                             <b style="color:#ffcc00; font-size:1.2rem;">${(d.deliveryFee || 0).toLocaleString()} KS</b>
                        </div>
                        <div style="display:flex; justify-content:space-between; font-weight:bold;">
                            <span style="color:#aaa;">💰 ပစ္စည်းဖိုး:</span>
                            <span style="color:#00ff00;">${(d.itemValue || 0).toLocaleString()} KS</span>
                        </div>
                    </div>

                    <div style="font-size:0.9rem; color:#eee; line-height:1.6; margin-bottom:15px;">
                        👤 <b>Cust:</b> ${d.customerName || "User"}<br>
                        📞 <b>ဖုန်း:</b> <a href="tel:${d.phone}" style="color:#00ff00; font-weight:bold;">${d.phone}</a><br>
                        📍 <b>From:</b> ${d.pickup?.address || d.pickupAddress}<br>
                        🏁 <b>To:</b> ${d.dropoff?.address || d.dropoffAddress}
                    </div>

                    <button style="width:100%; padding:15px; background:#ffcc00; color:#000; border:none; border-radius:8px; font-weight:bold; cursor:pointer;" 
                        onclick="${nextStatus==='completed'?`completeOrder('${id}')`:`updateStatus('${id}','${nextStatus}')` }">
                        ${btnText}
                    </button>`;
                list.appendChild(div);
            }
        });
        if(activeCountDisplay) activeCountDisplay.innerText = `${activeCount} / 3`;
        if(activeCount === 0) list.innerHTML = "<div class='empty-msg'>လက်ခံထားသော အော်ဒါမရှိပါ</div>";
    });

    // (C) Tomorrow Section (မနက်ဖြန်အော်ဒါများ - Start ခလုတ်ပါဝင်သည်)
    onSnapshot(query(collection(db, "orders"), where("tempRiderId", "==", myUid), where("status", "==", "pending_confirmation")), (snap) => {
        const tomList = document.getElementById('tomorrow-orders-list');
        if(tomList) {
            tomList.innerHTML = snap.empty ? "<div class='empty-msg'>မနက်ဖြန်အတွက် မရှိသေးပါ</div>" : "";
            snap.forEach(docSnap => {
                const d = docSnap.data();
                const id = docSnap.id;
                const div = document.createElement('div');
                div.className = 'order-card';
                div.style = "border-left: 5px solid #3498db; background:#1a1a1a; padding:15px; margin-bottom:10px;";
                div.innerHTML = `
                    <div style="color:#3498db; font-weight:bold; font-size:0.8rem; margin-bottom:8px;">📅 TOMORROW SCHEDULE</div>
                    <div style="display:flex; justify-content:space-between;">
                         <b style="color:#fff;">📦 ${d.item} (${d.weight || 0}kg)</b>
                         <b style="color:#ffcc00;">${(d.deliveryFee || 0).toLocaleString()} KS</b>
                    </div>
                    <div style="font-size:0.85rem; color:#aaa; margin-top:8px; background:#222; padding:10px; border-radius:5px;">
                        📞 <b>Phone:</b> ${d.phone} | 💰 <b>Value:</b> ${(d.itemValue || 0).toLocaleString()} KS<br>
                        📍 <b>P:</b> ${d.pickupAddress || d.pickup?.address}<br>
                        🏁 <b>D:</b> ${d.dropoffAddress || d.dropoff?.address}
                    </div>
                    <button onclick="startTomorrowOrder('${id}')" style="width:100%; margin-top:10px; padding:12px; background:#3498db; color:white; border:none; border-radius:5px; font-weight:bold;">🚀 ယနေ့အတွက် စတင်မည်</button>
                `;
                tomList.appendChild(div);
            });
        }
    });

    // (D) History Section (ဖယ်ထုတ်မည် Dismiss ခလုတ်ပါဝင်သည်)
    onSnapshot(query(collection(db, "orders"), where("riderId", "==", myUid), where("status", "==", "completed")), (snap) => {
        const historyList = document.getElementById('history-orders-list');
        const earningsDisplay = document.getElementById('total-earnings');
        let totalEarnings = 0;
        if(historyList) {
            historyList.innerHTML = snap.empty ? "<div class='empty-msg'>မှတ်တမ်းမရှိသေးပါ</div>" : "";
            snap.forEach(docSnap => {
                const h = docSnap.data();
                const id = docSnap.id;
                totalEarnings += (h.deliveryFee || 0);
                const div = document.createElement('div');
                div.className = 'history-card';
                div.style = "background:#1a1a1a; padding:15px; border-radius:10px; margin-bottom:10px; position:relative;";
                div.innerHTML = `
                    <div style="display:flex; justify-content:space-between;">
                        <span style="color:#fff; font-weight:bold;">✅ ${h.item}</span>
                        <span style="color:#00ff00; font-weight:bold;">+${h.deliveryFee?.toLocaleString()} KS</span>
                    </div>
                    <div style="font-size:0.75rem; color:#666; margin-top:5px;">
                        📅 ${h.completedAt?.toDate().toLocaleString() || 'ရက်စွဲမရှိပါ'}<br>
                        👤 Customer: ${h.customerName || "User"}
                    </div>
                    <button onclick="dismissHistory('${id}')" style="position:absolute; bottom:10px; right:10px; background:none; border:none; color:#ff4444; font-size:0.75rem; cursor:pointer; font-weight:bold;">✖ ဖယ်ထုတ်မည်</button>
                `;
                historyList.appendChild(div);
            });
            if(earningsDisplay) earningsDisplay.innerText = `${totalEarnings.toLocaleString()} KS`;
        }
    });
}

// --- Action Functions ---

window.handleAccept = async (id, time) => {
    try {
        const docRef = doc(db, "orders", id);
        const order = (await getDoc(docRef)).data();
        const riderName = await getRiderName();

        if(time === 'tomorrow') {
            await updateDoc(docRef, { status: "pending_confirmation", tempRiderId: auth.currentUser.uid, tempRiderName: riderName, pickupSchedule: "tomorrow" });
            await notifyTelegram(createOrderMessage("⏳ Tomorrow Scheduled", order, riderName, "မနက်ဖြန်အတွက် ကြိုတင်လက်ခံထားသည်"));
        } else {
            await updateDoc(docRef, { status: "accepted", riderId: auth.currentUser.uid, riderName: riderName, acceptedAt: serverTimestamp(), tempRiderId: null });
            fetch(SCRIPT_URL, { method: "POST", mode: "no-cors", body: JSON.stringify({ action: "update", orderId: id, riderName, status: "Accepted" }) });
            await notifyTelegram(createOrderMessage("✅ Order Accepted", order, riderName, "Rider လက်ခံလိုက်ပါပြီ"));
        }
    } catch (err) { console.error(err); }
};

window.startTomorrowOrder = async (id) => {
    const activeSnap = await getDocs(query(collection(db, "orders"), where("riderId", "==", auth.currentUser.uid), where("status", "in", ["accepted", "on_the_way", "arrived"])));
    if (activeSnap.size >= 3) { Swal.fire({ title: 'Limit Full!', text: 'လက်ရှိအော်ဒါ ၃ ခု ပြည့်နေပါသည်', icon: 'warning' }); return; }
    
    const docRef = doc(db, "orders", id);
    const order = (await getDoc(docRef)).data();
    const riderName = await getRiderName();
    await updateDoc(docRef, { status: "accepted", riderId: auth.currentUser.uid, riderName: riderName, acceptedAt: serverTimestamp(), tempRiderId: null });
    await notifyTelegram(createOrderMessage("🚀 Started Scheduled Order", order, riderName, "မနက်ဖြန်အော်ဒါကို စတင်လိုက်ပါပြီ"));
};

window.updateStatus = async (id, status) => {
    try {
        const docRef = doc(db, "orders", id);
        const order = (await getDoc(docRef)).data();
        const riderName = await getRiderName();
        await updateDoc(docRef, { status });
        const text = status === "on_the_way" ? "🚚 ပစ္စည်းစယူပြီး ထွက်ခွာလာပါပြီ" : "📍 Rider ရောက်ရှိနေပါပြီ";
        await notifyTelegram(createOrderMessage("🚀 Status Update", order, riderName, text));
    } catch (err) { console.error(err); }
};

window.completeOrder = async (id) => {
    const result = await Swal.fire({ title: 'ပြီးဆုံးပြီလား?', text: "ပို့ဆောင်ခ ရရှိပြီးပြီလား?", icon: 'question', showCancelButton: true, confirmButtonText: 'ဟုတ်ကဲ့', background: '#1a1a1a', color: '#fff' });
    if (result.isConfirmed) {
        try {
            const docRef = doc(db, "orders", id);
            const order = (await getDoc(docRef)).data();
            const riderName = await getRiderName();
            await updateDoc(docRef, { status: "completed", completedAt: serverTimestamp() });
            fetch(SCRIPT_URL, { method: "POST", mode: "no-cors", body: JSON.stringify({ action: "update", orderId: id, status: "COMPLETED" }) });
            await notifyTelegram(createOrderMessage("💰 Order Completed", order, riderName, "အောင်မြင်စွာ ပို့ဆောင်ပြီးပါပြီ"));
        } catch (err) { console.error(err); }
    }
};

window.cancelByRider = async (id) => {
    const result = await Swal.fire({ title: 'သေချာပါသလား?', text: "အော်ဒါကို ငြင်းပယ်ပါမည်။", icon: 'warning', showCancelButton: true, confirmButtonColor: '#ffcc00', background: '#1a1a1a', color: '#fff' });
    if (result.isConfirmed) {
        try { await updateDoc(doc(db, "orders", id), { status: "rider_rejected", riderId: null, riderName: null, lastRejectedRiderId: auth.currentUser.uid }); } catch (err) { console.error(err); }
    }
};

window.dismissHistory = async (id) => {
    // Rider list ကနေပဲ ဖယ်တာ ပိုစိတ်ချရပါတယ်
    await updateDoc(doc(db, "orders", id), { riderId: "dismissed_" + auth.currentUser.uid });
};

async function getRiderName() {
    const snap = await getDoc(doc(db, "riders", auth.currentUser.uid));
    return snap.exists() ? snap.data().name : "Rider";
}

const createOrderMessage = (title, order, currentRiderName, statusText = "") => {
    const pAddr = order.pickup?.address || order.pickupAddress || "မသိရပါ";
    const dAddr = order.dropoff?.address || order.dropoffAddress || "မသိရပါ";
    return `${title}\n📊 Status: <b>${statusText}</b>\n--------------------------\n📝 ပစ္စည်း: <b>${order.item}</b>\n💵 ပို့ခ: <b>${(order.deliveryFee || 0).toLocaleString()} KS</b>\n💰 ပစ္စည်းဖိုး: <b>${(order.itemValue || 0).toLocaleString()} KS</b>\n📞 ဖုန်း: <b>${order.phone}</b>\n📍 ယူရန်: ${pAddr}\n🏁 ပို့ရန်: ${dAddr}\n--------------------------\n🚴 Rider: <b>${currentRiderName}</b>`;
};

window.handleLogout = async () => { try { await signOut(auth); } catch (e) { console.error(e); } };
