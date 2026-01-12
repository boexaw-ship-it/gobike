let map = L.map('map').setView([16.82,96.15],12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

const riderIcon = L.icon({iconUrl:'../assets/bike.png',iconSize:[40,40],iconAnchor:[20,40]});
let markers={}, routes={}, colors={}, pickupMarker=null, dropMarker=null, orderLine=null;

function getRandomColor(uid){ if(colors[uid]) return colors[uid]; const c='#'+Math.floor(Math.random()*16777215).toString(16); colors[uid]=c; return c;}

map.on('click', function(e){
  if(!pickupMarker){
    pickupMarker=L.marker(e.latlng).addTo(map).bindPopup("Pickup").openPopup();
    document.getElementById("info").innerText=`Pickup at ${e.latlng.lat.toFixed(5)},${e.latlng.lng.toFixed(5)}`;
  } else if(!dropMarker){
    dropMarker=L.marker(e.latlng).addTo(map).bindPopup("Drop").openPopup();
    if(orderLine) map.removeLayer(orderLine);
    orderLine=L.polyline([pickupMarker.getLatLng(),dropMarker.getLatLng()],{color:'blue',weight:4}).addTo(map);
    document.getElementById("info").innerText+=` | Drop at ${e.latlng.lat.toFixed(5)},${e.latlng.lng.toFixed(5)}`;
    document.getElementById("submitOrder").disabled=false;
  }
});

db.collection("locations").where("role","==","rider").onSnapshot(snapshot=>{
  snapshot.docs.forEach(doc=>{
    const data=doc.data(); const rid=doc.id;
    if(!data.lat||!data.lng) return;
    const pos=[data.lat,data.lng];
    const popup=`<b>${data.name||rid}</b><br>Updated:${data.updatedAt?data.updatedAt.toDate().toLocaleTimeString():''}`;
    if(markers[rid]){markers[rid].setLatLng(pos); markers[rid].setPopupContent(popup);}
    else{markers[rid]=L.marker(pos,{icon:riderIcon}).addTo(map).bindPopup(popup);}
    if(!routes[rid]) routes[rid]=L.polyline([pos],{color:getRandomColor(rid),weight:4}).addTo(map);
    else{ const latlngs=routes[rid].getLatLngs(); latlngs.push(pos); routes[rid].setLatLngs(latlngs);}
  });
});

document.getElementById("submitOrder").onclick=()=>{
  if(!pickupMarker||!dropMarker) return alert("Pickup/Drop required");
  const pickup=pickupMarker.getLatLng(), drop=dropMarker.getLatLng();
  db.collection("orders").add({
    customerId: auth.currentUser.uid,
    pickup:{lat:pickup.lat,lng:pickup.lng},
    drop:{lat:drop.lat,lng:drop.lng},
    status:"pending",
    createdAt:firebase.firestore.FieldValue.serverTimestamp()
  }).then(()=>{
    alert("Order submitted!");
    map.removeLayer(pickupMarker); map.removeLayer(dropMarker); if(orderLine) map.removeLayer(orderLine);
    pickupMarker=null; dropMarker=null; orderLine=null;
    document.getElementById("submitOrder").disabled=true;
    document.getElementById("info").innerText="";
  });
};
