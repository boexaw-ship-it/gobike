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
soundBtn.onclick = () => { isSoundAllowed = true; alarmSound.play().then(() => { soundBtn.style.display = 'none'; }).catch(e => {}); };

// --- ၁။ Map Fix ---
let map;
function initMap() {
    const mapElement = document.getElementById('map');
    if (mapElement) {
        mapElement.style.height = "250px"; 
        map = L.map('map').setView([16.8661, 96.1951], 12); 
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    }
}

// --- ၂။ Auth & Profile ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        initMap();
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

// --- ၃။ Main Logic ---
function startTracking() {
    if (!auth.currentUser) return;
    const myUid = auth.currentUser.uid;

    if (navigator.geolocation) {
        navigator.geolocation.watchPosition(async (pos) => {
            const name = await getRiderName();
            await setDoc(doc(db, "active_riders", myUid), {
                name, lat: pos.coords.latitude, lng: pos.coords.longitude, lastSeen: serverTimestamp()
            }, { merge: true });
        }, null, { enableHighAccuracy: true });
    }

    // (A) Available Orders - အော်ဒါအဝင် ရှင်းလင်းစွာပြသခြင်း
    onSnapshot(query(collection(db, "orders"), where("status", "==", "pending")), async (snap) => {
        const container = document.getElementById('available-orders');
        if(!container) return;
        const activeSnap = await getDocs(query(collection(db, "orders"), where("riderId", "==", myUid), where("status", "in", ["accepted", "on_the_way", "arrived"])));
        const isFull = activeSnap.size >= 7;

        container.innerHTML = snap.empty ? "<div class='empty-msg'>အော်ဒါသစ်မရှိသေးပါ</div>" : "";
        snap.forEach(orderDoc => {
            const d = orderDoc.data();
            if (d.lastRejectedRiderId === myUid || d.tempRiderId === myUid || d.pickupSchedule === "tomorrow") return;
            
            const pFull = d.pickup ? `${d.pickup.township}၊ ${d.pickup.address}` : (d.pickupAddress || "-");
            const dFull = d.dropoff ? `${d.dropoff.township}၊ ${d.dropoff.address}` : (d.dropoffAddress || "-");

            const card = document.createElement('div');
            card.className = 'order-card';
            card.style = "background:#1a1a1a; border:1px solid #333; padding:15px; border-radius:12px; margin-bottom:15px; color:#fff;";
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between;">
                    <b style="font-size:1.1rem; color:#ffcc00;">📦 ${d.item} (${d.weight || 0}kg)</b>
                    <b style="color:#00ff00; font-size:1.1rem;">${(d.deliveryFee || 0).toLocaleString()} KS</b>
                </div>
                <div style="margin: 5px 0 10px 0;">
                    <span style="color:#00e5ff; font-size:0.85rem; background:#222; padding:2px 8px; border-radius:4px;">Value: ${(d.itemValue || 0).toLocaleString()} KS</span>
                </div>
                <div style="font-size:0.85rem; color:#aaa; line-height:1.5;">
                    <div style="margin-bottom:4px;"><b style="color:#ff4444;">📍 PICKUP:</b> ${pFull}</div>
                    <div><b style="color:#2ed573;">🏁 DROP:</b> ${dFull}</div>
                </div>
                <div style="display:flex; gap:10px; margin-top:12px;">
                    <button style="flex:2; background:#ffcc00; border:none; padding:12px; border-radius:8px; font-weight:bold;" onclick="handleAccept('${orderDoc.id}', 'now')">လက်ခံမည်</button>
                    <button style="flex:1; background:#333; color:#fff; border:none; padding:12px; border-radius:8px;" onclick="handleAccept('${orderDoc.id}', 'tomorrow')">မနက်ဖြန်</button>
                </div>`;
            container.appendChild(card);
        });
        if (!snap.empty && isSoundAllowed) alarmSound.play().catch(e => {});
    });

    // (B) Active Tasks List (With Reject Button)
    onSnapshot(query(collection(db, "orders"), where("riderId", "==", myUid)), (snap) => {
        const list = document.getElementById('active-orders-list');
        if(!list) return;
        list.innerHTML = "";
        snap.forEach(orderDoc => {
            const d = orderDoc.data();
            if (["accepted", "on_the_way", "arrived"].includes(d.status) && d.pickupSchedule !== "tomorrow") {
                const id = orderDoc.id;
                const div = document.createElement('div');
                div.className = 'order-card';
                div.style = "background:#1a1a1a; padding:15px; margin-bottom:12px; border-radius:10px; border-left:5px solid #ffcc00;";
                div.innerHTML = `
                    <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                        <b style="color:#ffcc00;">📦 ${d.item} (${d.weight}kg)</b>
                        <button onclick="rejectActiveOrder('${id}')" style="background:none; border:1px solid #ff4444; color:#ff4444; padding:2px 8px; border-radius:4px; font-size:0.8rem;">Reject</button>
                    </div>
                    <button style="width:100%; padding:10px; background:#ffcc00; border:none; border-radius:8px; font-weight:bold;" 
                        onclick="window.location.href='rider-track.html?id=${id}'">မြေပုံနှင့် အသေးစိတ်ကြည့်ရန်</button>`;
                list.appendChild(div);
            }
        });
    });

    // (E) History Section (With Delete & View Details)
    onSnapshot(query(collection(db, "orders"), where("riderId", "==", myUid), where("status", "==", "completed")), (snap) => {
        const historyList = document.getElementById('history-orders-list');
        const earningsDisplay = document.getElementById('total-earnings');
        let totalEarnings = 0;
        if(!historyList) return;
        historyList.innerHTML = snap.empty ? "<div class='empty-msg'>မှတ်တမ်းမရှိသေးပါ</div>" : "";
        snap.forEach(docSnap => {
            const h = docSnap.data();
            const id = docSnap.id;
            totalEarnings += (h.deliveryFee || 0);
            const div = document.createElement('div');
            div.className = 'history-card';
            div.style = "background:#1a1a1a; padding:15px; border-radius:10px; margin-bottom:10px; border-bottom:1px solid #333;";
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:start;">
                    <div>
                        <b style="color:#fff;">✅ ${h.item}</b><br>
                        <small style="color:#666;">${h.completedAt?.toDate().toLocaleString() || ''}</small>
                    </div>
                    <div style="text-align:right;">
                        <b style="color:#00ff00;">+${h.deliveryFee?.toLocaleString()} KS</b><br>
                        <div style="margin-top:5px;">
                            <button onclick="viewHistoryDetails('${id}')" style="background:#333; color:#fff; border:none; padding:4px 8px; border-radius:4px; font-size:0.75rem; margin-right:5px;">View</button>
                            <button onclick="deleteHistory('${id}')" style="background:#444; color:#ff4444; border:none; padding:4px 8px; border-radius:4px; font-size:0.75rem;">Delete</button>
                        </div>
                    </div>
                </div>`;
            historyList.appendChild(div);
        });
        if(earningsDisplay) earningsDisplay.innerText = `${totalEarnings.toLocaleString()} KS`;
    });
}

// --- Action Functions ---

window.rejectActiveOrder = async (id) => {
    const res = await Swal.fire({ title: 'Reject လုပ်မှာလား?', text: "အော်ဒါကို ပြန်လည်ပယ်ဖျက်မှာလား?", icon: 'warning', showCancelButton: true, confirmButtonColor: '#ff4444' });
    if (res.isConfirmed) {
        await updateDoc(doc(db, "orders", id), { status: "pending", riderId: null, lastRejectedRiderId: auth.currentUser.uid });
        Swal.fire('Reject လုပ်ပြီးပါပြီ', '', 'success');
    }
};

window.deleteHistory = async (id) => {
    const res = await Swal.fire({ title: 'မှတ်တမ်းဖျက်မလား?', text: "ဤမှတ်တမ်းကို History ထဲမှ အပြီးဖျက်ပါမည်။", icon: 'warning', showCancelButton: true });
    if (res.isConfirmed) {
        // Rider ဘက်ကနေပဲ မမြင်ရအောင် status တစ်ခုခုပြောင်းတာ (သို့) Rider ဖျက်လိုက်တယ်လို့ မှတ်တာ ပိုကောင်းပါတယ်။ 
        // ဤနေရာတွင် လုံးဝဖျက်လိုလျှင် deleteDoc သုံးနိုင်သည်
        await deleteDoc(doc(db, "orders", id));
        Swal.fire('ဖျက်ပြီးပါပြီ', '', 'success');
    }
};

window.viewHistoryDetails = async (id) => {
    const snap = await getDoc(doc(db, "orders", id));
    if (!snap.exists()) return;
    const d = snap.data();
    const p = d.pickup ? `${d.pickup.township}၊ ${d.pickup.address}` : d.pickupAddress;
    const drop = d.dropoff ? `${d.dropoff.township}၊ ${d.dropoff.address}` : d.dropoffAddress;

    Swal.fire({
        title: 'Order Details',
        html: `
            <div style="text-align:left; font-size:0.9rem;">
                <b>📦 ပစ္စည်း:</b> ${d.item} (${d.weight}kg)<br>
                <b>💵 ပို့ခ:</b> ${d.deliveryFee.toLocaleString()} KS<br>
                <b>💰 တန်ဖိုး:</b> ${d.itemValue.toLocaleString()} KS<br><br>
                <b style="color:#ff4444;">📍 Pickup:</b><br>${p}<br><br>
                <b style="color:#2ed573;">🏁 Drop:</b><br>${drop}
            </div>`,
        confirmButtonText: 'ပိတ်မည်',
        background: '#1a1a1a', color: '#fff'
    });
};

window.handleAccept = async (id, time) => {
    try {
        const docRef = doc(db, "orders", id);
        const orderSnap = await getDoc(docRef);
        const order = orderSnap.data();
        const riderName = await getRiderName();

        if(time === 'tomorrow') {
            await updateDoc(docRef, { status: "pending_confirmation", tempRiderId: auth.currentUser.uid, tempRiderName: riderName, pickupSchedule: "tomorrow" });
            Swal.fire({ title: 'စောင့်ဆိုင်းဆဲ', text: 'Customer အတည်ပြုချက် စောင့်နေပါသည်', icon: 'info' });
        } else {
            await updateDoc(docRef, { status: "accepted", riderId: auth.currentUser.uid, riderName: riderName, acceptedAt: serverTimestamp(), pickupSchedule: "now" });
            await notifyTelegram(createOrderMessage("✅ Accepted", order, riderName));
        }
    } catch (err) { console.error(err); }
};

async function getRiderName() {
    const snap = await getDoc(doc(db, "riders", auth.currentUser.uid));
    return snap.exists() ? snap.data().name : "Rider";
}

const createOrderMessage = (title, order, currentRiderName) => {
    const p = order.pickup ? `${order.pickup.township}၊ ${order.pickup.address}` : order.pickupAddress;
    const d = order.dropoff ? `${order.dropoff.township}၊ ${order.dropoff.address}` : order.dropoffAddress;
    return `${title}\n📦 ${order.item}\n💵 ပို့ခ: ${order.deliveryFee.toLocaleString()} KS\n📍 ${p}\n🏁 ${d}\n🚴 Rider: ${currentRiderName}`;
};

window.handleLogout = async () => { try { await signOut(auth); } catch (e) { console.error(e); } };
