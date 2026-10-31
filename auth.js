// =====================================================================
// JJ QBank — Google sign-in, progress sync and access control.
// Does nothing unless window.JJ_FIREBASE is set in firebase-config.js.
// =====================================================================
(function(){
  "use strict";
  const CFG = window.JJ_FIREBASE;
  if (!CFG || !CFG.apiKey) return;                       // sign-in is off → site behaves exactly as before

  const KEY = "msk-summative-v1", MARK = "jj-sync", SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
  const ADMINS = (window.JJ_ADMINS || []).map(e=>String(e).toLowerCase());
  const $ = id => document.getElementById(id);
  let auth, db, user = null, uref = null, pref = null, lastUploaded = null, rev = 0, kicked = false, unsubUser = null, uploading = false;

  // ---------------- gate (sign-in screen) ----------------
  const css = `
  .jjgate{position:fixed;inset:0;z-index:9990;background:#1b3550;background:radial-gradient(ellipse at 50% 40%,#22436a 0%,#1b3550 55%,#152a40 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;padding:24px;color:#e8eef5;text-align:center}
  .jjgate[hidden]{display:none}
  .jjgate img{width:min(440px,78vw);height:auto}
  .jjgate h2{margin:0;font-size:22px;font-weight:700}
  .jjgate p{margin:0;max-width:440px;color:#a9c0d3;font-size:14px;line-height:1.55}
  .jjgbtn{display:inline-flex;align-items:center;gap:12px;background:#fff;color:#1f2328;border:none;border-radius:10px;padding:12px 22px;font:600 16px/1 inherit;font-family:inherit;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25)}
  .jjgbtn:hover{transform:translateY(-1px)}
  .jjgbtn:disabled{opacity:.6;cursor:default;transform:none}
  .jjglink{background:none;border:none;color:#7fd3cb;font:inherit;font-size:14px;cursor:pointer;text-decoration:underline}
  .jjgstatus{min-height:20px;color:#cfe0ee;font-size:14px}
  .jjgstatus.err{color:#ffb4ab}
  .jjgnote{font-size:12px!important;color:#87a2b8!important}
  .jjacct{border-top:1px solid var(--line);padding:10px 14px;display:flex;align-items:center;gap:10px;font-size:12.5px;color:var(--muted)}
  .jjacct .av{width:28px;height:28px;border-radius:50%;flex:none;background:#2b9a91;color:#fff;display:grid;place-items:center;font-weight:700;overflow:hidden}
  .jjacct .av img{width:100%;height:100%;object-fit:cover}
  .jjacct .who{flex:1;min-width:0;line-height:1.3}
  .jjacct .who b{display:block;color:var(--text);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .jjacct .who span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .jjacct a,.jjacct button{background:none;border:1px solid var(--line2);color:var(--text);border-radius:7px;padding:4px 8px;font:inherit;font-size:12px;cursor:pointer;text-decoration:none;white-space:nowrap}
  .jjacct a:hover,.jjacct button:hover{border-color:var(--blue)}
  .jjsync{font-size:11px;color:var(--dim)}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  const logo = window.JJ_LOGO || (document.querySelector("#splash img") || {}).src || "";
  const gate = document.createElement("div");
  gate.className = "jjgate"; gate.id = "jjGate";
  gate.innerHTML = `${logo ? `<img src="${logo}" alt="JJ QBank">` : `<h2>JJ QBank</h2>`}
    <div id="jjGateBody"></div>
    <div class="jjgstatus" id="jjGateStatus">Checking sign-in…</div>
    <p class="jjgnote">Signing in with Google saves your answers, flags, notes and highlights to your account so they sync across your devices.</p>`;
  document.body.appendChild(gate);
  // Keep keyboard shortcuts from reaching the app behind the sign-in screen.
  document.addEventListener("keydown", e=>{ if (!gate.hidden && !gate.contains(e.target) && !(e.target.closest && e.target.closest("#splash"))) { e.stopPropagation(); } }, true);

  function gateStatus(msg, err){ const s = $("jjGateStatus"); s.textContent = msg || ""; s.classList.toggle("err", !!err); }
  function gateSignIn(){
    $("jjGateBody").innerHTML = `<h2 style="margin-bottom:14px">Sign in to continue</h2>
      <button class="jjgbtn" id="jjGoogle"><svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.8-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.8 6.1C6.6 42.6 14.6 48 24 48z"/></svg>Sign in with Google</button>`;
    gateStatus("");
    $("jjGoogle").onclick = signIn;
  }
  function gateBlocked(){
    $("jjGateBody").innerHTML = `<h2>Access removed</h2><p style="margin:10px auto 16px">Your access to JJ QBank has been removed by the site owner. If you think this is a mistake, contact them.</p><button class="jjglink" id="jjOther">Sign in with a different account</button>`;
    gateStatus("");
    $("jjOther").onclick = ()=>{ kicked = false; gateSignIn(); };
  }
  function showGate(){ gate.hidden = false; document.documentElement.classList.add("jjlock"); }
  function hideGate(){ gate.hidden = true; document.documentElement.classList.remove("jjlock"); }

  // ---------------- helpers ----------------
  const parse = t => { try { return JSON.parse(t) || {}; } catch(e) { return {}; } };
  const getMark = () => parse(localStorage.getItem(MARK) || "null");
  const setMark = r => { try { localStorage.setItem(MARK, JSON.stringify({uid:user.uid, rev:r})); } catch(e){} };
  const hasProgress = o => o && (Object.keys(o.ans||{}).length || Object.keys(o.notes||{}).length || Object.keys(o.flag||{}).length || (o.tests||[]).length || (o.anki||[]).length || Object.keys(o.hl||{}).length);
  const isAdmin = u => !!u && !!u.email && ADMINS.includes(u.email.toLowerCase());

  // Combine two saved states. Lists/maps are unioned; on a clash `winner` ("a" or "b") is kept.
  function merge(a, b, winner){
    const W = winner==="a" ? a : b, L = winner==="a" ? b : a;
    const out = Object.assign({}, L, W);
    const MAPS = ["ans","sel","strike","flag","notes","hl","order","qtime","first","chgq","posId","pos","scr","qshuf","snap","curBy","S_unused"];
    MAPS.forEach(k=>{ if (L[k] || W[k]) out[k] = Object.assign({}, L[k]||{}, W[k]||{}); });
    if (L.qtime || W.qtime) { out.qtime = Object.assign({}, out.qtime); Object.keys(L.qtime||{}).forEach(id=>{ out.qtime[id] = Math.max(+(L.qtime||{})[id]||0, +(W.qtime||{})[id]||0); }); }
    out.anki = Array.from(new Set([...(W.anki||[]), ...(L.anki||[])]));
    out.ac = ((W.ac||[]).length >= (L.ac||[]).length ? W.ac : L.ac) || [];
    // practice tests: keep both sets; renumber any id clash
    const tests = (W.tests||[]).map(t=>Object.assign({}, t)), used = new Set(tests.map(t=>t.id));
    let seq = Math.max(0, +W.testSeq||0, +L.testSeq||0, ...tests.map(t=>+t.id||0));
    (L.tests||[]).forEach(t=>{
      const same = tests.find(x=>x.id===t.id && x.name===t.name && JSON.stringify(x.ids)===JSON.stringify(t.ids));
      if (same) return;
      const c = Object.assign({}, t); if (used.has(c.id)) c.id = ++seq; used.add(c.id); tests.push(c);
    });
    out.tests = tests; out.testSeq = Math.max(seq, ...tests.map(t=>+t.id||0), 0);
    return out;
  }

  function reloadWith(stateStr){
    window.JJ_HOLD = true;                                      // stop the app from writing its old copy back
    try { localStorage.setItem(KEY, stateStr); sessionStorage.setItem("jj-skip-splash","1"); sessionStorage.setItem("jj-entered","1"); } catch(e){}
    location.reload();
  }

  async function upload(str, why){
    if (!user || kicked || uploading) return;
    uploading = true;
    try {
      const nextRev = rev + 1;
      let data = str;
      if (data.length > 950000) { const o = parse(data); delete o.hl; data = JSON.stringify(o); }   // stay under Firestore's 1 MB doc limit
      const stats = window.JJ_STATS ? window.JJ_STATS(parse(data)) : null;
      const batch = db.batch();
      batch.set(pref, {data, rev:nextRev, updatedAt:firebase.firestore.FieldValue.serverTimestamp(), size:data.length});
      batch.set(uref, {stats, lastSync:firebase.firestore.FieldValue.serverTimestamp(), lastSeen:firebase.firestore.FieldValue.serverTimestamp()}, {merge:true});
      await batch.commit();
      rev = nextRev; lastUploaded = str; setMark(rev);
      const el = $("jjSyncTime"); if (el) el.textContent = "Synced " + new Date().toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
    } catch(e) {
      console.warn("JJ sync failed (" + (why||"") + ")", e);
      const el = $("jjSyncTime"); if (el) el.textContent = "Sync paused — will retry";
    } finally { uploading = false; }
  }
  function checkUpload(why){
    if (!user || kicked || window.JJ_HOLD) return;
    const cur = localStorage.getItem(KEY);
    if (cur && cur !== lastUploaded) upload(cur, why);
  }

  // ---------------- sign-in flow ----------------
  async function signIn(){
    const btn = $("jjGoogle"); if (btn) btn.disabled = true;
    gateStatus("Opening Google sign-in…");
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({prompt:"select_account"});
    try { await auth.signInWithPopup(provider); }
    catch(e) {
      if (["auth/popup-blocked","auth/operation-not-supported-in-environment","auth/cancelled-popup-request"].includes(e.code)) { try { await auth.signInWithRedirect(provider); return; } catch(e2) { e = e2; } }
      if (e.code === "auth/popup-closed-by-user") gateStatus("Sign-in was closed before finishing. Try again.", true);
      else if (e.code === "auth/unauthorized-domain") gateStatus("This site's address isn't authorized in Firebase yet (Authentication → Settings → Authorized domains).", true);
      else gateStatus("Couldn't sign in: " + (e.message || e.code || e), true);
      if (btn) btn.disabled = false;
    }
  }

  async function afterSignIn(u){
    gateStatus("Loading your progress…");
    user = u; uref = db.collection("users").doc(u.uid); pref = uref.collection("private").doc("progress");
    let udoc;
    try { udoc = await uref.get(); }
    catch(e) { gateStatus("Couldn't load your account. Check your connection and refresh.", true); return; }
    if (udoc.exists && udoc.data().blocked && !isAdmin(u)) { kicked = true; gateBlocked(); showGate(); await auth.signOut(); return; }

    // profile (blocked can only ever be set by an admin)
    const FV = firebase.firestore.FieldValue, prof = {uid:u.uid, email:u.email||"", name:u.displayName||"", photo:u.photoURL||"", lastSeen:FV.serverTimestamp(), sessions:FV.increment(1)};
    if (!udoc.exists) { prof.firstSeen = FV.serverTimestamp(); prof.blocked = false; }
    try { await uref.set(prof, {merge:true}); } catch(e) { console.warn("JJ profile write failed", e); }

    // ---- progress ----
    let cloud = null;
    try { const p = await pref.get(); cloud = p.exists ? p.data() : null; } catch(e) { console.warn("JJ progress read failed", e); }
    const mark = getMark();
    let localStr = localStorage.getItem(KEY);
    if (mark.uid && mark.uid !== u.uid) localStr = null;                 // this browser holds someone else's progress
    const local = localStr ? parse(localStr) : null;

    if (!cloud) {                                                        // brand-new account
      rev = 0;
      if (local && hasProgress(local)) { await upload(localStr, "first"); }
      else { setMark(0); }
      if (mark.uid && mark.uid !== u.uid) return reloadWith("{}");
      return ready();
    }
    rev = cloud.rev || 0;
    if (mark.uid === u.uid && mark.rev === rev) {                        // this device is up to date with the cloud
      lastUploaded = null; checkUpload("resume"); return ready();
    }
    let merged;
    if (mark.uid === u.uid) merged = merge(local||{}, parse(cloud.data), "a");       // cloud changed on another device; keep this device's newer edits on clashes
    else if (local && hasProgress(local)) merged = merge(local, parse(cloud.data), "b"); // first time on this device: combine, cloud wins clashes
    else merged = parse(cloud.data);
    const mStr = JSON.stringify(merged);
    if (mStr !== cloud.data) { await upload(mStr, "merge"); } else { setMark(rev); }
    if (mStr === localStorage.getItem(KEY)) return ready();
    return reloadWith(mStr);
  }

  function ready(){
    hideGate();
    accountChip();
    if (unsubUser) unsubUser();
    unsubUser = uref.onSnapshot(d=>{                                     // removed by the admin while using the site → sign out now
      if (d.exists && d.data().blocked && !isAdmin(user)) kick();
    }, ()=>{});
  }

  async function kick(){
    if (kicked) return; kicked = true;
    window.JJ_HOLD = true;
    try { localStorage.removeItem(KEY); localStorage.removeItem(MARK); } catch(e){}
    try { await auth.signOut(); } catch(e){}
    gateBlocked(); showGate();
  }

  function accountChip(){
    const side = $("side"); if (!side || !user) return;
    let el = $("jjAcct"); if (!el) { el = document.createElement("div"); el.className = "jjacct"; el.id = "jjAcct"; side.appendChild(el); }
    const init = (user.displayName || user.email || "?").trim().charAt(0).toUpperCase();
    el.innerHTML = `<span class="av">${user.photoURL ? `<img src="${user.photoURL}" alt="" referrerpolicy="no-referrer">` : init}</span>
      <span class="who"><b>${esc(user.displayName || "Signed in")}</b><span>${esc(user.email || "")}</span><span class="jjsync" id="jjSyncTime">Sync on</span></span>
      ${isAdmin(user) ? `<a href="admin.html" title="See who uses the site">Admin</a>` : ""}<button id="jjSignOut" title="Sign out">Sign out</button>`;
    $("jjSignOut").onclick = signOut;
  }
  function esc(t){ return String(t).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

  async function signOut(){
    if (!confirm("Sign out of JJ QBank? Your progress is saved to your account and will come back when you sign in again.")) return;
    const cur = localStorage.getItem(KEY);
    if (cur && cur !== lastUploaded) await upload(cur, "signout");
    window.JJ_HOLD = true;
    try { localStorage.removeItem(KEY); localStorage.removeItem(MARK); sessionStorage.setItem("jj-skip-splash","1"); } catch(e){}
    try { await auth.signOut(); } catch(e){}
    location.reload();
  }

  // ---------------- boot ----------------
  function load(src){ return new Promise((res, rej)=>{ const s = document.createElement("script"); s.src = SDK + src; s.onload = res; s.onerror = ()=>rej(new Error("load " + src)); document.head.appendChild(s); }); }
  showGate();
  load("firebase-app-compat.js").then(()=>Promise.all([load("firebase-auth-compat.js"), load("firebase-firestore-compat.js")])).then(()=>{
    firebase.initializeApp(CFG);
    auth = firebase.auth(); db = firebase.firestore();
    auth.getRedirectResult().catch(e=>{ if (e && e.code) gateStatus("Couldn't sign in: " + (e.message || e.code), true); });
    auth.onAuthStateChanged(u=>{
      if (u) { afterSignIn(u); }
      else { user = null; if (!kicked) gateSignIn(); showGate(); }
    });
    setInterval(()=>checkUpload("timer"), 20000);
    document.addEventListener("visibilitychange", ()=>{ if (document.hidden) checkUpload("hidden"); });
    window.addEventListener("pagehide", ()=>checkUpload("pagehide"));
  }).catch(()=>{
    gateStatus("Couldn't reach the sign-in service. Check your internet connection and refresh the page.", true);
  });
})();
