let confirmationResult;

function sendOTP() {
  const phone = document.getElementById("phone").value;
  const status = document.getElementById("status");
  const role = document.getElementById("role").value;

  if (!phone) return alert("Enter phone number");

  const appVerifier = new firebase.auth.RecaptchaVerifier('status', {
    size: 'invisible'
  });

  auth.signInWithPhoneNumber(phone, appVerifier)
    .then(res => {
      confirmationResult = res;
      status.innerText = "OTP sent!";
      localStorage.setItem("role", role);
    })
    .catch(err => status.innerText = err.message);
}

function verifyOTP() {
  const otp = document.getElementById("otp").value;
  const status = document.getElementById("status");
  const role = localStorage.getItem("role");

  confirmationResult.confirm(otp)
    .then(result => {
      const user = result.user;
      status.innerText = "Login successful! UID: " + user.uid;

      db.collection("users").doc(user.uid).set({
        phone: user.phoneNumber,
        role: role,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }, {merge:true});

      if(role === "customer") location.href="html/customer.html";
      else if(role === "rider") location.href="html/rider.html";
      else if(role === "admin") location.href="html/admin.html";
    })
    .catch(err => status.innerText = "OTP verification failed: " + err.message);
}
