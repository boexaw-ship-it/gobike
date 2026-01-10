function login() {
  const name = document.getElementById("name").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const role = document.getElementById("role").value;
  const status = document.getElementById("status");

  if (!name || !phone) {
    status.innerText = "Please enter name and phone";
    return;
  }

  auth.signInAnonymously()
    .then((res) => {
      const uid = res.user.uid;

      return db.collection("users").doc(uid).set({
        name: name,
        phone: phone,
        role: role,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    })
    .then(() => {
      status.innerText = "Login successful";

      if (role === "customer") {
        window.location.href = "html/customer.html";
      } else {
        window.location.href = "html/delivery.html";
      }
    })
    .catch((err) => {
      status.innerText = err.message;
    });
}
