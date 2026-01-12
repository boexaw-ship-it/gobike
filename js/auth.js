// js/auth.js
export function checkAuth(role, redirect="../index.html"){
  auth.onAuthStateChanged(user=>{
    if(!user){ location.href=redirect; return; }
    db.collection("users").doc(user.uid).get().then(doc=>{
      if(!doc.exists || doc.data().role !== role){
        alert("Unauthorized"); location.href=redirect;
      }
    });
  });
}

export function signOut(){
  auth.signOut().then(()=>location.href="../index.html");
}
