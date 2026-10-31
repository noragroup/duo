// account.js - Comptes : retrouver sa progression sur tous ses appareils
//
// PRINCIPE
//  - Tout joueur commence en "invité" (compte anonyme Firebase) : le jeu reste jouable sans compte.
//  - "Créer un compte" RELIE un e-mail (ou Google) au compte invité. L'identifiant du joueur ne
//    change pas : progression, points DUO, skins et amis sont conservés.
//  - "Se connecter" depuis un autre appareil remplace le compte invité de cet appareil par le
//    compte existant (la page est rechargée pour tout réinitialiser proprement).
//
// Aucun serveur : tout passe par Firebase Authentication, côté navigateur.
// À activer dans la console Firebase : Authentication > Sign-in method > "E-mail/Mot de passe"
// et "Google" (et, pour Google, ton domaine dans Authentication > Settings > Authorized domains).

import {
    ref,
    get,
    set
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";

import {
    signInAnonymously,
    signInWithEmailAndPassword,
    signInWithCredential,
    linkWithCredential,
    linkWithPopup,
    EmailAuthProvider,
    GoogleAuthProvider,
    signOut,
    sendPasswordResetEmail,
    sendEmailVerification
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

// Succès "Compte sécurisé" : débloqué dès qu'un e-mail ou Google est relié au compte
import { recordAccountLinked } from "./progress.js";

// Données enregistrées sur l'appareil (à effacer quand on change de compte)
const KEY_NAME = "duo-player-name";
const KEY_DUO_ID = "duo-player-id";
const KEY_EQUIPPED = "duo-equipped-skins";
const KEY_OWNED = "duo-owned-skins";

let auth = null;
let db = null;

// État de la fenêtre "Compte"
const state = {
    tab: "create",           // "create" | "login" (compte invité)
    email: "",
    password: "",
    message: null,           // { type: "error" | "success" | "info", text }
    busy: false,
    confirmReplace: false,   // 2e étape : confirmer le remplacement de la progression de cet appareil
    pendingCredential: null, // compte Google existant, en attente de confirmation
    signOutConfirm: false
};

// ---------------------------------------------------------------------------
// OUTILS
// ---------------------------------------------------------------------------

function el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function isValidEmail(email) {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

// Changer de compte en pleine partie n'est pas possible : on doit d'abord quitter le salon
function isInRoom() {
    return document.body.classList.contains("in-game");
}

function readLocalJson(key) {
    try {
        return JSON.parse(localStorage.getItem(key) || "{}") || {};
    } catch (error) {
        return {};
    }
}

function describeAuthError(error) {
    switch (error?.code) {
        case "auth/invalid-email":
            return "Adresse e-mail invalide.";
        case "auth/email-already-in-use":
            return "Cette adresse e-mail a déjà un compte. Utilise l'onglet « Se connecter ».";
        case "auth/weak-password":
            return "Mot de passe trop faible (6 caractères minimum).";
        case "auth/invalid-credential":
        case "auth/invalid-login-credentials":
        case "auth/wrong-password":
        case "auth/user-not-found":
            return "E-mail ou mot de passe incorrect.";
        case "auth/too-many-requests":
            return "Trop de tentatives. Réessaie dans quelques minutes.";
        case "auth/network-request-failed":
            return "Problème de connexion. Vérifie ton réseau et réessaie.";
        case "auth/popup-closed-by-user":
        case "auth/cancelled-popup-request":
            return "Connexion annulée.";
        case "auth/popup-blocked":
            return "Le navigateur a bloqué la fenêtre Google. Autorise les pop-ups pour ce site.";
        case "auth/operation-not-allowed":
            return "Cette méthode de connexion n'est pas activée (Firebase > Authentication > Sign-in method).";
        case "auth/unauthorized-domain":
            return "Ce site n'est pas autorisé pour la connexion Google (Firebase > Authentication > Settings > Authorized domains).";
        case "auth/provider-already-linked":
            return "Ce compte est déjà relié.";
        default:
            return "Une erreur est survenue. Réessaie dans un instant.";
    }
}

// ---------------------------------------------------------------------------
// INITIALISATION
// ---------------------------------------------------------------------------

// À appeler une fois : initAccount({ auth, db, onUser })
// onUser(user) est appelé quand le joueur est prêt (invité ou connecté à un compte).
export async function initAccount({ auth: authInstance, db: database, onUser }) {
    auth = authInstance;
    db = database;

    buildAccountButton();

    // On attend que Firebase ait restauré une éventuelle session (compte ou invité) avant de décider
    await auth.authStateReady();
    if (!auth.currentUser) await signInAnonymously(auth);

    const user = auth.currentUser;

    try {
        await syncProfile(user);
    } catch (error) {
        console.error("Synchronisation du profil impossible :", error);
    }

    refreshAccountUI();
    await onUser(user);
}

// Récupère depuis le compte : pseudo, ID DUO et skins équipés (pour retrouver son profil sur un autre appareil)
async function syncProfile(user) {
    const snapshot = await get(ref(db, `users/${user.uid}`));
    const data = snapshot.val() || {};

    // Pseudo ("Joueur" est la valeur par défaut, pas un vrai pseudo)
    if (data.username && data.username !== "Joueur") {
        localStorage.setItem(KEY_NAME, data.username);

        const input = document.getElementById("player-name");
        if (input) input.value = data.username;
    }

    // ID DUO : celui du compte fait foi
    if (data.duoId) localStorage.setItem(KEY_DUO_ID, data.duoId);

    // Skins équipés : ceux du compte, sinon on envoie ceux de cet appareil vers le compte
    if (data.equippedSkins) {
        localStorage.setItem(KEY_EQUIPPED, JSON.stringify(data.equippedSkins));
    } else {
        pushEquippedSkins();
    }
}

// Enregistre les skins équipés sur le compte (appelé à chaque changement de skin)
export function pushEquippedSkins() {
    const user = auth?.currentUser;
    if (!user || !db) return;

    const equipped = readLocalJson(KEY_EQUIPPED);
    const value = Object.keys(equipped).length > 0 ? equipped : null;

    set(ref(db, `users/${user.uid}/equippedSkins`), value).catch(error => {
        console.error("Impossible d'enregistrer les skins équipés :", error);
    });
}

// ---------------------------------------------------------------------------
// BOUTON "COMPTE" (à côté de "Nouveautés") ET ENCART DANS LA FENÊTRE NIVEAUX
// ---------------------------------------------------------------------------

function buildAccountButton() {
    const row = document.getElementById("player-name-row");
    if (!row || document.getElementById("account-button")) return;

    const button = el("button", "", "👤 Compte");
    button.id = "account-button";
    button.type = "button";
    button.addEventListener("click", openAccountPopup);
    row.appendChild(button);
}

// Encart "Compte invité / Progression sauvegardée" sous la progression de la fenêtre Niveaux
export function renderAccountBanner() {
    const panel = document.getElementById("levels-sidebar-panel");
    const user = auth?.currentUser;
    if (!panel || !user) return;

    let banner = document.getElementById("levels-account-banner");
    if (!banner) {
        banner = el("div", "");
        banner.id = "levels-account-banner";
        panel.insertBefore(banner, document.getElementById("levels-sidebar-body"));
    }

    banner.innerHTML = "";
    banner.className = user.isAnonymous ? "guest" : "linked";

    banner.appendChild(el(
        "span",
        "",
        user.isAnonymous
            ? "⚠️ Compte invité : ta progression reste sur cet appareil."
            : "✅ Progression sauvegardée sur ton compte."
    ));

    const button = el("button", "", user.isAnonymous ? "Créer un compte" : "Mon compte");
    button.type = "button";
    button.addEventListener("click", openAccountPopup);
    banner.appendChild(button);
}

function refreshAccountUI() {
    const user = auth?.currentUser;
    const button = document.getElementById("account-button");

    if (button && user) {
        button.textContent = user.isAnonymous ? "👤 Se connecter" : "👤 Mon compte";
        button.classList.toggle("linked", !user.isAnonymous);
    }

    renderAccountBanner();

    if (document.getElementById("account-popup")?.style.display === "flex") {
        renderAccountView();
    }
}

// ---------------------------------------------------------------------------
// FENÊTRE "COMPTE"
// ---------------------------------------------------------------------------

function ensureAccountPopup() {
    let popup = document.getElementById("account-popup");
    if (popup) return popup;

    popup = el("div", "");
    popup.id = "account-popup";
    popup.style.display = "none";

    const content = el("div", "");
    content.id = "account-popup-content";

    const closeButton = el("button", "", "✕");
    closeButton.id = "close-account-button";
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Fermer");
    closeButton.addEventListener("click", closeAccountPopup);

    const view = el("div", "");
    view.id = "account-view";

    content.append(closeButton, view);
    popup.appendChild(content);

    // Cliquer à côté de la fenêtre la ferme
    popup.addEventListener("click", (event) => {
        if (event.target === popup) closeAccountPopup();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeAccountPopup();
    });

    document.body.appendChild(popup);
    return popup;
}

function resetTransientState() {
    state.password = "";
    state.message = null;
    state.busy = false;
    state.confirmReplace = false;
    state.pendingCredential = null;
    state.signOutConfirm = false;
}

function openAccountPopup() {
    const popup = ensureAccountPopup();
    resetTransientState();
    renderAccountView();
    popup.style.display = "flex";
}

function closeAccountPopup() {
    const popup = document.getElementById("account-popup");
    if (!popup || popup.style.display === "none") return;

    popup.style.display = "none";
    resetTransientState();
}

// Message d'erreur / de réussite affiché dans la fenêtre
function setMessage(type, text) {
    state.message = text ? { type, text } : null;

    const box = document.getElementById("account-message");
    if (!box) return;

    box.className = state.message ? `account-message ${type}` : "account-message";
    box.textContent = state.message ? text : "";
}

function setBusy(busy) {
    state.busy = busy;
    document.querySelectorAll("#account-view button, #account-view input").forEach(control => {
        control.disabled = busy;
    });
}

function renderAccountView() {
    const view = document.getElementById("account-view");
    const user = auth?.currentUser;
    if (!view || !user) return;

    view.innerHTML = "";

    if (user.isAnonymous) {
        renderGuestView(view);
    } else {
        renderAccountInfo(view, user);
    }

    // Le message courant est (ré)affiché sans reconstruire tout le reste
    setMessage(state.message?.type, state.message?.text);
}

function buildMessageBox() {
    const box = el("div", "account-message");
    box.id = "account-message";
    box.setAttribute("role", "status");
    return box;
}

// --- Vue "invité" : créer un compte ou se connecter ---

function renderGuestView(view) {
    view.appendChild(el("h2", "", "👤 Compte invité"));
    view.appendChild(el(
        "p",
        "account-intro",
        "Tu joues en invité : ta progression (niveau, points DUO, skins) n'est sauvegardée que sur cet appareil. " +
        "Crée un compte pour la retrouver sur tous tes appareils."
    ));

    view.appendChild(buildMessageBox());

    // Google
    const google = el("button", "account-google");
    google.type = "button";
    google.appendChild(el("span", "account-google-logo", "G"));
    google.appendChild(el(
        "span",
        "",
        state.pendingCredential ? "Confirmer et me connecter avec Google" : "Continuer avec Google"
    ));
    google.addEventListener("click", continueWithGoogle);
    view.appendChild(google);

    view.appendChild(el("div", "account-separator", "ou avec une adresse e-mail"));

    // Onglets
    const tabs = el("div", "account-tabs");
    [["create", "Créer un compte"], ["login", "Se connecter"]].forEach(([id, label]) => {
        const tab = el("button", "account-tab", label);
        tab.type = "button";
        if (state.tab === id) tab.classList.add("active");
        tab.addEventListener("click", () => {
            state.tab = id;
            state.confirmReplace = false;
            state.pendingCredential = null;
            state.message = null;
            renderAccountView();
        });
        tabs.appendChild(tab);
    });
    view.appendChild(tabs);

    // Formulaire e-mail
    const form = el("form", "account-form");
    form.noValidate = true;

    const email = el("input", "account-input");
    email.type = "email";
    email.placeholder = "Adresse e-mail";
    email.autocomplete = "email";
    email.value = state.email;
    email.addEventListener("input", () => { state.email = email.value; });

    const password = el("input", "account-input");
    password.type = "password";
    password.placeholder = state.tab === "create" ? "Mot de passe (6 caractères minimum)" : "Mot de passe";
    password.autocomplete = state.tab === "create" ? "new-password" : "current-password";
    password.value = state.password;
    password.addEventListener("input", () => { state.password = password.value; });

    form.append(email, password);

    if (state.tab === "login") {
        const forgot = el("button", "account-link", "Mot de passe oublié ?");
        forgot.type = "button";
        forgot.addEventListener("click", resetPassword);
        form.appendChild(forgot);
    }

    const submit = el("button", "account-submit");
    submit.id = "account-submit";
    submit.type = "submit";
    submit.textContent = state.tab === "create"
        ? "Créer mon compte"
        : state.confirmReplace ? "Confirmer et me connecter" : "Me connecter";
    form.appendChild(submit);

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        submitEmailForm();
    });

    view.appendChild(form);

    view.appendChild(el(
        "p",
        "account-note",
        state.tab === "create"
            ? "✅ Ta progression actuelle est conservée : elle sera simplement rattachée à ton compte."
            : "⚠️ Se connecter à un compte existant remplace la progression de cet appareil par celle du compte."
    ));
}

// --- Vue "compte connecté" ---

function renderAccountInfo(view, user) {
    view.appendChild(el("h2", "", "👤 Mon compte"));
    view.appendChild(buildMessageBox());

    const providers = (user.providerData || []).map(info => info.providerId);
    const usesGoogle = providers.includes("google.com");
    const usesPassword = providers.includes("password");

    const rows = el("div", "account-rows");
    const addRow = (label, value) => {
        const row = el("div", "account-row");
        row.appendChild(el("span", "account-row-label", label));
        row.appendChild(el("span", "account-row-value", value));
        rows.appendChild(row);
    };

    addRow("E-mail", user.email || "—");
    addRow("Connexion", [usesGoogle ? "Google" : null, usesPassword ? "E-mail et mot de passe" : null].filter(Boolean).join(" + ") || "—");
    addRow("Pseudo", localStorage.getItem(KEY_NAME) || "Joueur");
    addRow("ID DUO", localStorage.getItem(KEY_DUO_ID) || "—");
    view.appendChild(rows);

    view.appendChild(el(
        "p",
        "account-note",
        "✅ Ta progression est sauvegardée. Connecte-toi avec ce compte sur un autre appareil pour la retrouver."
    ));

    // E-mail à confirmer
    if (usesPassword && !user.emailVerified) {
        const verify = el("div", "account-verify");
        verify.appendChild(el("span", "", "⚠️ Adresse e-mail non confirmée."));

        const resend = el("button", "account-link", "Renvoyer l'e-mail de confirmation");
        resend.type = "button";
        resend.addEventListener("click", resendVerification);
        verify.appendChild(resend);

        view.appendChild(verify);
    }

    const actions = el("div", "account-actions");

    if (usesPassword) {
        const reset = el("button", "account-secondary", "Changer le mot de passe");
        reset.type = "button";
        reset.addEventListener("click", resetPassword);
        actions.appendChild(reset);
    }

    const logout = el("button", "account-danger", state.signOutConfirm ? "Confirmer la déconnexion" : "Se déconnecter");
    logout.id = "account-logout";
    logout.type = "button";
    logout.addEventListener("click", logoutAccount);
    actions.appendChild(logout);

    view.appendChild(actions);

    if (state.signOutConfirm) {
        view.appendChild(el(
            "p",
            "account-note",
            "Tu repartiras avec un compte invité vierge sur cet appareil. Ta progression reste sur ton compte."
        ));
    }
}

// ---------------------------------------------------------------------------
// ACTIONS
// ---------------------------------------------------------------------------

// Le compte invité de cet appareil a-t-il déjà une progression à perdre ?
async function guestHasProgress() {
    try {
        const snapshot = await get(ref(db, `users/${auth.currentUser.uid}/progress`));
        const progress = snapshot.val();
        return !!progress && ((progress.exp || 0) > 0 || (progress.gamesPlayed || 0) > 0);
    } catch (error) {
        return true; // dans le doute, on demande confirmation
    }
}

// Après avoir changé de compte : on efface ce qui appartenait à l'ancien et on recharge la page
function finishAccountSwitch() {
    localStorage.removeItem(KEY_DUO_ID);
    localStorage.removeItem(KEY_OWNED);
    localStorage.removeItem(KEY_EQUIPPED);
    location.reload();
}

async function submitEmailForm() {
    if (state.busy) return;

    const email = state.email.trim();
    const password = state.password;

    if (!isValidEmail(email)) {
        setMessage("error", "Entre une adresse e-mail valide.");
        return;
    }
    if (password.length < 6) {
        setMessage("error", "Le mot de passe doit contenir au moins 6 caractères.");
        return;
    }

    setBusy(true);
    try {
        if (state.tab === "create") {
            await createAccount(email, password);
        } else {
            await loginWithEmail(email, password);
        }
    } catch (error) {
        console.error("Erreur de compte :", error);
        setMessage("error", describeAuthError(error));
    } finally {
        // (si la page se recharge, rien de tout ça n'a d'importance)
        if (document.getElementById("account-view")) setBusy(false);
    }
}

// Relie un e-mail au compte invité : même identifiant, donc rien n'est perdu
async function createAccount(email, password) {
    const user = auth.currentUser;
    const credential = EmailAuthProvider.credential(email, password);
    const result = await linkWithCredential(user, credential);

    let mailSent = true;
    try {
        await sendEmailVerification(result.user);
    } catch (error) {
        mailSent = false;
    }

    state.password = "";
    state.message = {
        type: "success",
        text: mailSent
            ? "✅ Compte créé ! Ta progression est maintenant sauvegardée. Un e-mail de confirmation t'a été envoyé."
            : "✅ Compte créé ! Ta progression est maintenant sauvegardée."
    };
    refreshAccountUI();
    recordAccountLinked();
}

async function loginWithEmail(email, password) {
    if (isInRoom()) {
        setMessage("error", "Quitte le salon avant de te connecter à un autre compte.");
        return;
    }

    // La progression du compte invité de cet appareil va être remplacée : on demande confirmation
    if (!state.confirmReplace && await guestHasProgress()) {
        state.confirmReplace = true;
        state.message = {
            type: "info",
            text: "⚠️ La progression de cet appareil (compte invité) sera remplacée par celle de ton compte. Clique sur « Confirmer » pour continuer."
        };
        renderAccountView();
        return;
    }

    await signInWithEmailAndPassword(auth, email, password);
    finishAccountSwitch();
}

async function continueWithGoogle() {
    if (state.busy) return;
    const user = auth.currentUser;
    if (!user?.isAnonymous) return;

    // 2e étape : un compte Google existant a été trouvé, l'utilisateur confirme le changement
    if (state.pendingCredential) {
        if (isInRoom()) {
            setMessage("error", "Quitte le salon avant de te connecter à un autre compte.");
            return;
        }
        setBusy(true);
        try {
            await signInWithCredential(auth, state.pendingCredential);
            finishAccountSwitch();
        } catch (error) {
            console.error("Erreur de compte :", error);
            setBusy(false);
            setMessage("error", describeAuthError(error));
        }
        return;
    }

    setBusy(true);
    try {
        // Premier essai : relier Google au compte invité (on garde la progression)
        await linkWithPopup(user, new GoogleAuthProvider());

        state.message = { type: "success", text: "✅ Compte Google relié ! Ta progression est maintenant sauvegardée." };
        setBusy(false);
        refreshAccountUI();
        recordAccountLinked();
    } catch (error) {
        const credential = GoogleAuthProvider.credentialFromError(error);

        // Ce compte Google existe déjà : se connecter à ce compte remplace celui de cet appareil
        if (error?.code === "auth/credential-already-in-use" && credential) {
            if (isInRoom()) {
                setBusy(false);
                setMessage("error", "Ce compte Google existe déjà. Quitte le salon pour t'y connecter.");
                return;
            }

            if (!(await guestHasProgress())) {
                try {
                    await signInWithCredential(auth, credential);
                    finishAccountSwitch();
                } catch (signInError) {
                    setBusy(false);
                    setMessage("error", describeAuthError(signInError));
                }
                return;
            }

            state.pendingCredential = credential;
            state.message = {
                type: "info",
                text: "Ce compte Google existe déjà. ⚠️ La progression de cet appareil (compte invité) sera remplacée par celle de ce compte. Clique sur « Confirmer » pour continuer."
            };
            setBusy(false);
            renderAccountView();
            return;
        }

        console.error("Erreur de compte :", error);
        setBusy(false);
        setMessage("error", describeAuthError(error));
    }
}

async function resetPassword() {
    if (state.busy) return;
    const user = auth.currentUser;

    // Invité : l'e-mail saisi dans le formulaire. Connecté : l'e-mail du compte.
    const email = user && !user.isAnonymous ? user.email : state.email.trim();

    if (!isValidEmail(email || "")) {
        setMessage("error", "Entre d'abord ton adresse e-mail dans le formulaire.");
        return;
    }

    setBusy(true);
    try {
        await sendPasswordResetEmail(auth, email);
        setMessage("success", "Si un compte existe avec cette adresse, un e-mail pour choisir un nouveau mot de passe vient d'être envoyé.");
    } catch (error) {
        console.error("Erreur de compte :", error);
        setMessage("error", describeAuthError(error));
    } finally {
        setBusy(false);
    }
}

async function resendVerification() {
    if (state.busy) return;

    setBusy(true);
    try {
        await sendEmailVerification(auth.currentUser);
        setMessage("success", "E-mail de confirmation envoyé.");
    } catch (error) {
        console.error("Erreur de compte :", error);
        setMessage("error", describeAuthError(error));
    } finally {
        setBusy(false);
    }
}

async function logoutAccount() {
    if (state.busy) return;

    if (isInRoom()) {
        setMessage("error", "Quitte le salon avant de te déconnecter.");
        return;
    }

    // 1er clic : on demande confirmation
    if (!state.signOutConfirm) {
        state.signOutConfirm = true;
        renderAccountView();
        return;
    }

    setBusy(true);
    try {
        await signOut(auth);

        // L'appareil ne doit rien garder de ce compte (pseudo, ID DUO, skins) : sinon le prochain invité en hériterait
        [KEY_NAME, KEY_DUO_ID, KEY_EQUIPPED, KEY_OWNED].forEach(key => localStorage.removeItem(key));
        location.reload();
    } catch (error) {
        console.error("Erreur de compte :", error);
        setBusy(false);
        setMessage("error", describeAuthError(error));
    }
}