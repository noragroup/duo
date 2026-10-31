// progress.js - Progression du joueur (EXP, niveau, points DUO, skins débloqués),
// boutique et succès
//
// Les données sont stockées dans Firebase : users/<uid>/progress
// (tes règles actuelles autorisent déjà chaque joueur à écrire dans son propre users/<uid>)

import {
    ref,
    onValue,
    runTransaction
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";

import { setOwnedSkins, focusSkin, DECKS } from "./skins.js";

import {
    getShopSkins,
    getSkinById,
    getPurchaseStatus,
    applyPurchase,
    getMissingLevelRewards,
    applyLevelRewardsCatchUp
} from "./shop.js";

import {
    LEVEL_CONFIG,
    getLevelProgress,
    totalExpForLevel,
    getNextReward,
    getLevelReward,
    getRewardTableMaxLevel,
    createEmptyProgress,
    applyGameReward
} from "./levels.js";

import {
    ACHIEVEMENTS,
    ACHIEVEMENT_CATEGORIES,
    getAchievementView,
    getAchievementsSummary,
    applyAchievementUnlocksWithExp
} from "./achievements.js";

let db = null;
let uid = null;
let progress = createEmptyProgress();
let serverOffset = 0; // écart entre l'horloge de l'appareil et celle de Firebase

// Parties déjà traitées pendant cette session (évite de créditer deux fois)
const processedGames = new Set();

// ---------------------------------------------------------------------------
// OUTILS
// ---------------------------------------------------------------------------

function el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function formatNumber(value) {
    return Math.round(value).toLocaleString("fr-FR");
}

// Heure du serveur Firebase (fiable même si l'horloge de l'appareil est décalée)
export function getServerTime() {
    return Date.now() + serverOffset;
}

// ---------------------------------------------------------------------------
// INITIALISATION
// ---------------------------------------------------------------------------

// À appeler une fois connecté : initProgress({ db, playerId })
export function initProgress({ db: database, playerId }) {
    db = database;
    uid = playerId;

    ensureLevelsSidebar();
    ensureShopSidebar();
    ensureAchievementsPopup();

    onValue(ref(db, ".info/serverTimeOffset"), (snapshot) => {
        serverOffset = snapshot.val() || 0;
    });

    onValue(ref(db, `users/${uid}/progress`), (snapshot) => {
        progress = { ...createEmptyProgress(), ...(snapshot.val() || {}) };

        // Les skins débloqués (niveaux, achats) deviennent utilisables
        setOwnedSkins(Object.keys(progress.unlockedSkins || {}));

        renderProgressUI();

        // Rattrapages (si un niveau ou un succès a changé après coup, ou a été manqué) :
        // skins de niveau, puis succès déjà remplis mais pas encore marqués comme débloqués.
        syncLevelRewards();
        syncAchievements();
    });

    renderProgressUI();
}

// ---------------------------------------------------------------------------
// FIN DE PARTIE : ATTRIBUTION DE L'EXP
// ---------------------------------------------------------------------------

// À appeler à chaque mise à jour de la salle (depuis le listener de script.js)
// mode : "duo" ou "duo-no-mercy", pour les statistiques par mode (succès)
export function handleRoomProgress(room, myId, mode) {
    if (!room || !myId) return;

    // Tant que la partie n'est pas finie, pas de récapitulatif à l'écran
    if (room.status !== "finished") {
        clearGameReward();
        return;
    }

    const gameId = room.gameId;
    if (!gameId || processedGames.has(gameId)) return;
    processedGames.add(gameId);

    // Seuls les joueurs présents au lancement de la partie sont récompensés
    const participants = room.participants || [];
    if (!participants.includes(myId)) return;

    if (participants.length < LEVEL_CONFIG.minParticipants) {
        renderGameReward({ status: "notEnoughPlayers" });
        return;
    }

    const duration = getServerTime() - (room.startedAt || 0);
    if (duration < LEVEL_CONFIG.minGameDurationMs) {
        renderGameReward({ status: "tooShort" });
        return;
    }

    // Place au classement final et nombre de joueurs classés
    // (ceux qui ont quitté la partie en cours ne sont pas comptés)
    const ranking = room.finishOrder || [];
    const totalPlayers = Math.max(ranking.length, 1);
    const position = ranking.indexOf(myId);
    const rank = position >= 0 ? position + 1 : totalPlayers; // introuvable : dernière place

    // En No Mercy : nombre d'adversaires éliminés (utile pour les succès),
    // et si moi-même j'ai été éliminé pendant cette partie
    const eliminated = room.game?.eliminated || [];
    const eliminatedCount = eliminated.length;
    const wasEliminated = eliminated.includes(myId);

    awardGameEnd({ gameId, rank, totalPlayers, mode, eliminatedCount, wasEliminated })
        .then(summary => {
            if (summary) renderGameReward({ status: "rewarded", summary });
        })
        .catch(error => console.error("Impossible d'enregistrer l'EXP :", error));
}

// Crédite l'EXP dans Firebase. La transaction garantit qu'une même partie
// ne peut jamais être créditée deux fois (même en rechargeant la page).
async function awardGameEnd({ gameId, rank, totalPlayers, mode, eliminatedCount, wasEliminated }) {
    if (!db || !uid) return null;

    let summary = null;

    const result = await runTransaction(ref(db, `users/${uid}/progress`), (current) => {
        if (current && current.lastRewardedGame === gameId) {
            return; // déjà crédité : on annule
        }

        const applied = applyGameReward(current, { rank, totalPlayers, gameId, mode, eliminatedCount, wasEliminated });

        // Succès débloqués par cette partie (ou par les nouvelles statistiques qu'elle a produites).
        // Leur EXP peut elle-même faire franchir un niveau (et donc débloquer un skin) : c'est géré ici.
        const achieved = applyAchievementUnlocksWithExp(applied.progress);

        summary = {
            ...applied.summary,
            newExp: achieved.progress.exp,
            newLevel: getLevelProgress(achieved.progress.exp).level,
            levelsGained: applied.summary.levelsGained + achieved.levelsGained,
            pointsGained: applied.summary.pointsGained + achieved.levelPointsGained,
            newSkins: [...applied.summary.newSkins, ...achieved.newSkins],
            newAchievements: achieved.newlyUnlocked,
            achievementPoints: achieved.achievementPoints
        };

        return achieved.progress;
    });

    return result.committed ? summary : null;
}

// ---------------------------------------------------------------------------
// AFFICHAGE : PASTILLE DE NIVEAU + FENÊTRE "NIVEAUX" (à droite de l'écran)
// ---------------------------------------------------------------------------

function buildBar(ratio, className) {
    const bar = el("div", className);
    const fill = el("div", `${className}-fill`);
    fill.style.width = `${Math.round(ratio * 100)}%`;
    bar.appendChild(fill);
    return bar;
}

function getNextRewardText(info) {
    const next = getNextReward(info.level);
    if (!next) return "🏆 Toutes les récompenses de skins sont débloquées !";

    const names = next.skins.map(skin => skin.name).join(", ");
    const remaining = totalExpForLevel(next.level) - progress.exp;
    return `🎁 Prochain skin : ${names} (niveau ${next.level}, encore ${formatNumber(remaining)} EXP)`;
}

// --- Pastille de niveau (cliquer ouvre la fenêtre Niveaux ; cachée en jeu par le CSS) ---

function renderLevelChip(info) {
    let chip = document.getElementById("level-chip");

    if (!chip) {
        chip = el("button", "");
        chip.id = "level-chip";
        chip.type = "button";
        chip.addEventListener("click", () => {
            const sidebar = document.getElementById("levels-sidebar");
            setLevelsOpen(!(sidebar && sidebar.classList.contains("open")));
        });
        document.body.appendChild(chip);
    }

    chip.title = `${formatNumber(info.expInLevel)} / ${formatNumber(info.expNeeded)} EXP — ${formatNumber(progress.duoPoints || 0)} points DUO`;
    chip.innerHTML = "";
    chip.appendChild(el("span", "level-chip-level", `⭐ Niv. ${info.level}`));
    chip.appendChild(buildBar(info.ratio, "level-chip-bar"));
}

// --- Fenêtre "Niveaux" ---

let skinSidebarLinked = false;

function closeSkinSidebar() {
    document.getElementById("skin-sidebar")?.classList.remove("open");
    document.getElementById("skin-sidebar-toggle")?.setAttribute("aria-expanded", "false");
}

// Quand on ouvre "Personnalisation", on ferme "Niveaux" et "Boutique" (elles sont au même endroit)
function linkSkinSidebar() {
    if (skinSidebarLinked) return;
    const skinToggle = document.getElementById("skin-sidebar-toggle");
    if (!skinToggle) return;

    skinToggle.addEventListener("click", () => {
        setLevelsOpen(false);
        setShopOpen(false);
        setAchievementsOpen(false);
    });
    skinSidebarLinked = true;
}

function scrollToCurrentLevel() {
    const body = document.getElementById("levels-sidebar-body");
    if (!body) return;

    const target = body.querySelector(".level-box.current") || body.querySelector(".level-box");
    if (!target) return;

    requestAnimationFrame(() => {
        body.scrollTop = Math.max(0, target.offsetTop - body.clientHeight / 2 + target.offsetHeight / 2);
    });
}

function setLevelsOpen(open) {
    const sidebar = document.getElementById("levels-sidebar");
    const toggle = document.getElementById("levels-sidebar-toggle");
    if (!sidebar || !toggle) return;

    sidebar.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));

    if (open) {
        closeSkinSidebar();
        setShopOpen(false);
        setAchievementsOpen(false);
        scrollToCurrentLevel();
    }
}

function ensureLevelsSidebar() {
    linkSkinSidebar();
    if (document.getElementById("levels-sidebar")) return;

    const sidebar = el("aside", "");
    sidebar.id = "levels-sidebar";

    const toggle = el("button", "", "⭐");
    toggle.id = "levels-sidebar-toggle";
    toggle.type = "button";
    toggle.title = "Niveaux et récompenses";
    toggle.setAttribute("aria-label", "Niveaux et récompenses");
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", () => {
        setLevelsOpen(!sidebar.classList.contains("open"));
    });

    const panel = el("div", "");
    panel.id = "levels-sidebar-panel";

    const header = el("div", "");
    header.id = "levels-sidebar-header";
    header.appendChild(el("h2", "", "⭐ Niveaux"));

    const closeButton = el("button", "", "✕");
    closeButton.id = "levels-sidebar-close";
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Fermer");
    closeButton.addEventListener("click", () => setLevelsOpen(false));
    header.appendChild(closeButton);

    const progressCard = el("div", "");
    progressCard.id = "levels-progress";

    const body = el("div", "");
    body.id = "levels-sidebar-body";

    panel.append(header, progressCard, body);
    sidebar.append(toggle, panel);
    document.body.appendChild(sidebar);

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") setLevelsOpen(false);
    });
}

// Carte du haut : niveau, EXP, points DUO, prochain skin
function renderLevelsProgress(info) {
    const card = document.getElementById("levels-progress");
    if (!card) return;
    card.innerHTML = "";

    const top = el("div", "levels-progress-top");
    top.appendChild(el("span", "levels-progress-level", `⭐ Niveau ${info.level}`));
    top.appendChild(el("span", "levels-progress-points", `🪙 ${formatNumber(progress.duoPoints || 0)} pts DUO`));
    card.appendChild(top);

    card.appendChild(buildBar(info.ratio, "levels-progress-bar"));
    card.appendChild(el("div", "levels-progress-exp", `${formatNumber(info.expInLevel)} / ${formatNumber(info.expNeeded)} EXP`));
    card.appendChild(el("div", "levels-progress-next", getNextRewardText(info)));
}

// Un petit encadré = un niveau et ses récompenses
function buildLevelBox(level, currentLevel) {
    const reward = getLevelReward(level);

    const box = el("div", "level-box");
    if (level <= currentLevel) box.classList.add("reached");
    if (level === currentLevel) box.classList.add("current");
    if (reward.skins.length > 0) box.classList.add("has-skin");
    if (reward.points > LEVEL_CONFIG.duoPointsPerLevel) box.classList.add("milestone");

    const head = el("div", "level-box-head");
    head.appendChild(el("span", "level-box-number", `Niveau ${level}`));
    if (level <= currentLevel) head.appendChild(el("span", "level-box-check", "✓"));
    box.appendChild(head);

    box.appendChild(el("div", "level-reward", `🪙 +${reward.points} points DUO`));

    reward.skins.forEach(skin => {
        const row = el("div", "level-reward level-reward-skin");

        // Aperçu : le dos de carte du skin (fichier "back" dans son dossier)
        const img = document.createElement("img");
        img.src = `${skin.folder}${skin.back || "back"}.${skin.extension || "webp"}`;
        img.alt = "";
        img.loading = "lazy";
        img.addEventListener("error", () => img.remove()); // image absente : on la cache
        row.appendChild(img);

        const text = el("div", "level-reward-skin-text");
        text.appendChild(el("div", "level-reward-skin-name", `🎨 ${skin.name}`));
        text.appendChild(el("div", "level-reward-skin-deck", `Paquet ${DECKS[skin.deck]?.name || skin.deck}`));
        row.appendChild(text);

        box.appendChild(row);
    });

    return box;
}

function renderLevelsList(info) {
    const body = document.getElementById("levels-sidebar-body");
    if (!body) return;
    body.innerHTML = "";

    const grid = el("div", "levels-grid");
    const maxLevel = getRewardTableMaxLevel(info.level);
    for (let level = 1; level <= maxLevel; level++) {
        grid.appendChild(buildLevelBox(level, info.level));
    }
    body.appendChild(grid);

    body.appendChild(el(
        "p",
        "levels-footer",
        `🏅 EXP par partie : ${LEVEL_CONFIG.expFirstPlace} pour le 1er, jusqu'à ${LEVEL_CONFIG.expLastPlace} pour le dernier, selon ta place au classement.`
    ));

    body.appendChild(el(
        "p",
        "levels-footer",
        `♾️ Ça continue après le niveau ${maxLevel} : +${LEVEL_CONFIG.duoPointsPerLevel} points DUO à chaque niveau, +${LEVEL_CONFIG.duoPointsMilestone} tous les ${LEVEL_CONFIG.duoPointsMilestoneEvery} niveaux.`
    ));
}

function renderProgressUI() {
    const info = getLevelProgress(progress.exp || 0);
    ensureLevelsSidebar();
    renderLevelChip(info);
    renderLevelsProgress(info);
    renderLevelsList(info);
    renderShop();
}

// ---------------------------------------------------------------------------
// MESSAGE TEMPORAIRE (skins débloqués, achats...)
// ---------------------------------------------------------------------------

let noticeTimer = null;

function showNotice(message) {
    let notice = document.getElementById("reward-notice");

    if (!notice) {
        notice = el("div", "");
        notice.id = "reward-notice";
        document.body.appendChild(notice);
    }

    notice.textContent = message;
    notice.classList.add("show");

    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => notice.classList.remove("show"), 5000);
}

// Message affiché quand un ou plusieurs succès viennent d'être débloqués
function showAchievementNotice(achievements) {
    if (!achievements || achievements.length === 0) return;

    if (achievements.length === 1) {
        const a = achievements[0];
        showNotice(`🏆 Succès débloqué : ${a.icon} ${a.name} (+${a.exp} EXP, +${a.points} pts DUO)`);
    } else {
        const totalExp = achievements.reduce((sum, a) => sum + a.exp, 0);
        const totalPoints = achievements.reduce((sum, a) => sum + a.points, 0);
        showNotice(`🏆 ${achievements.length} succès débloqués ! (+${totalExp} EXP, +${totalPoints} pts DUO)`);
    }

    renderAchievements(); // la fenêtre Succès, si elle est ouverte, doit refléter le déblocage
}

// ---------------------------------------------------------------------------
// RATTRAPAGE DES SKINS DE NIVEAU
// ---------------------------------------------------------------------------
// Si un niveau de récompense est modifié (ou un skin ajouté) après coup, les joueurs
// qui ont déjà dépassé ce niveau reçoivent le skin à leur prochaine connexion.

let syncingRewards = false;

async function syncLevelRewards() {
    if (!db || !uid || syncingRewards) return;
    if (getMissingLevelRewards(progress).length === 0) return;

    syncingRewards = true;
    try {
        let granted = [];

        const result = await runTransaction(ref(db, `users/${uid}/progress`), (current) => {
            if (!current) return; // pas de progression : rien à rattraper

            const applied = applyLevelRewardsCatchUp(current);
            if (applied.newSkins.length === 0) return;

            granted = applied.newSkins;
            return applied.progress;
        });

        if (result.committed && granted.length > 0) {
            const plural = granted.length > 1 ? "s" : "";
            showNotice(`🎁 Skin${plural} débloqué${plural} : ${granted.map(skin => skin.name).join(", ")}`);
        }
    } catch (error) {
        console.error("Impossible de rattraper les skins de niveau :", error);
    } finally {
        syncingRewards = false;
    }
}

// Succès déjà remplis (stats actuelles) mais jamais marqués comme débloqués — par exemple
// si un succès a été ajouté après coup, ou si une précédente tentative a échoué.
let syncingAchievements = false;

async function syncAchievements() {
    if (!db || !uid || syncingAchievements) return;

    syncingAchievements = true;
    try {
        let granted = [];

        const result = await runTransaction(ref(db, `users/${uid}/progress`), (current) => {
            if (!current) return; // pas de progression : rien à rattraper

            const achieved = applyAchievementUnlocksWithExp(current);
            if (achieved.newlyUnlocked.length === 0) return;

            granted = achieved.newlyUnlocked;
            return achieved.progress;
        });

        if (result.committed && granted.length > 0) {
            showAchievementNotice(granted);
        }
    } catch (error) {
        console.error("Impossible de rattraper les succès :", error);
    } finally {
        syncingAchievements = false;
    }
}

// ---------------------------------------------------------------------------
// STATISTIQUES HORS PARTIE (amis, compte relié...) UTILISÉES PAR LES SUCCÈS
// ---------------------------------------------------------------------------

// Fusionne un "patch" dans progress.stats, puis débloque les succès nouvellement complétés.
// Utilisé pour les statistiques qui ne viennent pas d'une fin de partie (amis, compte relié...).
async function updateStatsAndAchievements(statsPatch) {
    if (!db || !uid) return;

    let grantedSkins = [];
    let grantedAchievements = [];

    try {
        await runTransaction(ref(db, `users/${uid}/progress`), (current) => {
            const base = { ...createEmptyProgress(), ...current, stats: { ...createEmptyProgress().stats, ...(current?.stats || {}), ...statsPatch } };

            const achieved = applyAchievementUnlocksWithExp(base);
            grantedSkins = achieved.newSkins;
            grantedAchievements = achieved.newlyUnlocked;

            return achieved.progress;
        });

        if (grantedAchievements.length > 0) showAchievementNotice(grantedAchievements);
        if (grantedSkins.length > 0) {
            const plural = grantedSkins.length > 1 ? "s" : "";
            showNotice(`🎁 Skin${plural} débloqué${plural} : ${grantedSkins.map(skin => skin.name).join(", ")}`);
        }
    } catch (error) {
        console.error("Impossible de mettre à jour la progression :", error);
    }
}

// À appeler quand le joueur crée un compte ou relie Google (voir account.js)
export function recordAccountLinked() {
    return updateStatsAndAchievements({ accountLinked: true });
}

// À appeler avec le nombre d'amis actuel, après l'acceptation d'une demande (voir script.js)
export function recordFriendsCount(count) {
    return updateStatsAndAchievements({ friendsCount: count });
}

// ---------------------------------------------------------------------------
// BOUTIQUE : ACHATS
// ---------------------------------------------------------------------------

// Achète un skin avec des points DUO. La transaction vérifie le prix, le solde et le skin de
// base (pour une variante) au moment de l'achat : impossible de dépenser deux fois les mêmes points.
async function purchaseSkin(skinId) {
    if (!db || !uid) return { ok: false, error: "offline" };

    let outcome = { ok: false, error: "unknown" };

    try {
        const result = await runTransaction(ref(db, `users/${uid}/progress`), (current) => {
            outcome = applyPurchase(current, skinId);
            if (!outcome.ok) return; // refusé : on annule

            // Un achat peut lui-même débloquer un succès (ex : "Petit investisseur",
            // ou "Garde-robe complète" si c'était le dernier skin manquant)
            const achieved = applyAchievementUnlocksWithExp(outcome.progress);
            outcome = { ...outcome, progress: achieved.progress, achievements: achieved.newlyUnlocked, newSkinsFromAchievements: achieved.newSkins };

            return achieved.progress;
        });

        if (!result.committed) return { ok: false, error: outcome.error || "aborted" };
        return outcome;
    } catch (error) {
        console.error("Achat impossible :", error);
        return { ok: false, error: "network" };
    }
}

// ---------------------------------------------------------------------------
// BOUTIQUE : FENÊTRE (à droite de l'écran)
// ---------------------------------------------------------------------------

let confirmSkinId = null;   // article en attente de confirmation d'achat
let confirmTimer = null;
let purchasingSkinId = null; // achat en cours (évite le double clic)

function setShopOpen(open) {
    const sidebar = document.getElementById("shop-sidebar");
    const toggle = document.getElementById("shop-sidebar-toggle");
    if (!sidebar || !toggle) return;

    sidebar.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));

    if (open) {
        closeSkinSidebar();
        setLevelsOpen(false);
        setAchievementsOpen(false);
        renderShop();
    } else {
        resetPurchaseConfirmation();
    }
}

function resetPurchaseConfirmation() {
    clearTimeout(confirmTimer);
    confirmSkinId = null;
}

function ensureShopSidebar() {
    linkSkinSidebar();
    if (document.getElementById("shop-sidebar")) return;

    const sidebar = el("aside", "");
    sidebar.id = "shop-sidebar";

    const toggle = el("button", "", "🛒");
    toggle.id = "shop-sidebar-toggle";
    toggle.type = "button";
    toggle.title = "Boutique";
    toggle.setAttribute("aria-label", "Boutique");
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", () => {
        setShopOpen(!sidebar.classList.contains("open"));
    });

    const panel = el("div", "");
    panel.id = "shop-sidebar-panel";

    const header = el("div", "");
    header.id = "shop-sidebar-header";
    header.appendChild(el("h2", "", "🛒 Boutique"));

    const closeButton = el("button", "", "✕");
    closeButton.id = "shop-sidebar-close";
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Fermer");
    closeButton.addEventListener("click", () => setShopOpen(false));
    header.appendChild(closeButton);

    const balance = el("div", "");
    balance.id = "shop-balance";

    const body = el("div", "");
    body.id = "shop-sidebar-body";

    panel.append(header, balance, body);
    sidebar.append(toggle, panel);
    document.body.appendChild(sidebar);

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") setShopOpen(false);
    });

    renderShop();
}

// Une ligne de la boutique : aperçu, nom, prix et bouton selon la situation du joueur
function buildShopItem(skin) {
    const status = getPurchaseStatus(progress, skin);
    const parent = skin.parent ? getSkinById(skin.parent) : null;

    const item = el("div", "shop-item");

    const preview = el("div", "skin-preview");
    (skin.preview || []).forEach(fileName => {
        const img = document.createElement("img");
        img.src = `${skin.folder}${fileName}.${skin.extension || "webp"}`;
        img.alt = "";
        img.loading = "lazy";
        img.addEventListener("error", () => img.remove()); // image absente : on la cache
        preview.appendChild(img);
    });
    item.appendChild(preview);

    item.appendChild(el("div", "shop-item-tag", parent ? `Variante de ${parent.name}` : "Nouveau paquet"));
    item.appendChild(el("div", "shop-item-name", skin.name));
    if (skin.description) item.appendChild(el("div", "skin-description", skin.description));

    const footer = el("div", "shop-item-footer");
    footer.appendChild(el("div", "shop-price", `🪙 ${formatNumber(skin.price || 0)}`));

    const actions = el("div", "shop-actions");

    if (status.status === "missing-parent") {
        const locked = el("button", "shop-button", `🔒 Obtiens d'abord ${status.parent.name}`);
        locked.type = "button";
        locked.disabled = true;
        actions.appendChild(locked);
    } else if (status.status === "too-expensive") {
        const poor = el("button", "shop-button", `Il te manque ${formatNumber(status.missing)} pts`);
        poor.type = "button";
        poor.disabled = true;
        actions.appendChild(poor);
    } else if (status.status === "available") {
        const confirming = confirmSkinId === skin.id;
        const busy = purchasingSkinId === skin.id;

        const buy = el("button", "shop-button shop-buy", busy ? "Achat…" : confirming ? "Confirmer l'achat" : "Acheter");
        buy.type = "button";
        buy.disabled = busy;
        if (confirming) buy.classList.add("confirm");

        buy.addEventListener("click", async () => {
            // 1er clic : on demande confirmation (annulée toute seule après 4 secondes)
            if (confirmSkinId !== skin.id) {
                resetPurchaseConfirmation();
                confirmSkinId = skin.id;
                confirmTimer = setTimeout(() => { resetPurchaseConfirmation(); renderShop(); }, 4000);
                renderShop();
                return;
            }

            // 2e clic : achat
            resetPurchaseConfirmation();
            purchasingSkinId = skin.id;
            renderShop();

            const result = await purchaseSkin(skin.id);
            purchasingSkinId = null;

            if (result.ok) {
                showNotice(`✅ ${result.summary.name} acheté ! Retrouve-le dans Personnalisation.`);
                focusSkin(result.summary.skinId); // la personnalisation s'ouvrira sur ce skin
                if (result.achievements?.length > 0) showAchievementNotice(result.achievements);
            } else {
                showNotice("❌ Achat impossible, réessaie dans un instant.");
            }
            renderShop();
        });
        actions.appendChild(buy);
    }

    footer.appendChild(actions);
    item.appendChild(footer);

    return item;
}

function renderShop() {
    const balance = document.getElementById("shop-balance");
    const body = document.getElementById("shop-sidebar-body");
    if (!balance || !body) return;

    // Solde de points DUO
    balance.innerHTML = "";
    balance.appendChild(el("div", "shop-balance-amount", `🪙 ${formatNumber(progress.duoPoints || 0)} points DUO`));
    balance.appendChild(el("div", "shop-balance-hint", "Tu gagnes des points à chaque niveau atteint."));

    const previousScroll = body.scrollTop;
    body.innerHTML = "";

    const shopSkins = getShopSkins();
    if (shopSkins.length === 0) {
        body.appendChild(el("p", "shop-empty", "La boutique est vide pour le moment."));
        return;
    }

    // Les articles déjà achetés quittent la boutique : on les retrouve dans Personnalisation
    const forSale = shopSkins.filter(skin => getPurchaseStatus(progress, skin).status !== "owned");
    const ownedCount = shopSkins.length - forSale.length;

    // Un bloc par jeu, articles du moins cher au plus cher
    Object.entries(DECKS).forEach(([deckId, deck]) => {
        const items = forSale
            .filter(skin => skin.deck === deckId)
            .sort((a, b) => (a.price || 0) - (b.price || 0));
        if (items.length === 0) return;

        const section = el("section", "shop-deck");
        section.appendChild(el("h3", "shop-deck-title", `Paquets ${deck.name}`));
        items.forEach(skin => section.appendChild(buildShopItem(skin)));
        body.appendChild(section);
    });

    if (forSale.length === 0) {
        body.appendChild(el("p", "shop-empty", "🎉 Tu as tout acheté ! Retrouve tes paquets dans Personnalisation."));
    }

    if (ownedCount > 0) {
        const plural = ownedCount > 1 ? "s" : "";

        const note = el("div", "shop-owned-note");
        note.appendChild(el("span", "", `✓ ${ownedCount} article${plural} déjà acheté${plural}`));

        const link = el("button", "shop-owned-link", "🎨 Voir dans Personnalisation");
        link.type = "button";
        link.addEventListener("click", () => {
            document.getElementById("skin-sidebar-toggle")?.click();
        });
        note.appendChild(link);

        body.appendChild(note);
    }

    body.scrollTop = previousScroll;
}

// ---------------------------------------------------------------------------
// FENÊTRE "SUCCÈS" (menu centré, pas une barre latérale)
// ---------------------------------------------------------------------------

let achievementsCategory = "general"; // onglet affiché

function setAchievementsOpen(open) {
    const popup = document.getElementById("achievements-popup");
    const toggle = document.getElementById("achievements-toggle");
    if (!popup || !toggle) return;

    popup.style.display = open ? "flex" : "none";
    toggle.setAttribute("aria-expanded", String(open));

    if (open) {
        closeSkinSidebar();
        setLevelsOpen(false);
        setShopOpen(false);
        renderAchievements();
    }
}

function ensureAchievementsPopup() {
    if (document.getElementById("achievements-popup")) return;

    // Languette : un bouton fixe de plus, sous celles de Personnalisation / Niveaux / Boutique
    const toggle = el("button", "", "🏆");
    toggle.id = "achievements-toggle";
    toggle.type = "button";
    toggle.title = "Succès";
    toggle.setAttribute("aria-label", "Succès");
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", () => {
        const popup = document.getElementById("achievements-popup");
        setAchievementsOpen(popup?.style.display !== "flex");
    });
    document.body.appendChild(toggle);

    // Fenêtre centrée (même principe que la fenêtre Compte : overlay + boîte, pas de tiroir)
    const popup = el("div", "");
    popup.id = "achievements-popup";
    popup.style.display = "none";

    const content = el("div", "");
    content.id = "achievements-popup-content";

    const closeButton = el("button", "", "✕");
    closeButton.id = "close-achievements-button";
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Fermer");
    closeButton.addEventListener("click", () => setAchievementsOpen(false));

    const header = el("div", "");
    header.id = "achievements-header";
    header.appendChild(el("h2", "", "🏆 Succès"));
    header.appendChild(el("p", "", "Débloque des succès en jouant pour gagner de l'EXP et des points DUO."));

    const summary = el("div", "");
    summary.id = "achievements-summary";

    const tabs = el("div", "");
    tabs.id = "achievements-tabs";
    tabs.setAttribute("role", "tablist");

    const body = el("div", "");
    body.id = "achievements-body";

    content.append(closeButton, header, summary, tabs, body);
    popup.appendChild(content);

    // Cliquer à côté de la fenêtre la ferme
    popup.addEventListener("click", (event) => {
        if (event.target === popup) setAchievementsOpen(false);
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") setAchievementsOpen(false);
    });

    document.body.appendChild(popup);
}

function renderAchievementTabs() {
    const tabs = document.getElementById("achievements-tabs");
    if (!tabs) return;
    tabs.innerHTML = "";

    ACHIEVEMENT_CATEGORIES.forEach(category => {
        const tab = el("button", "achievement-tab", `${category.icon} ${category.name}`);
        tab.type = "button";
        tab.setAttribute("role", "tab");

        const isActive = category.id === achievementsCategory;
        tab.setAttribute("aria-selected", String(isActive));
        if (isActive) tab.classList.add("active");

        tab.addEventListener("click", () => {
            achievementsCategory = category.id;
            renderAchievements();
        });
        tabs.appendChild(tab);
    });
}

function buildAchievementCard(achievement) {
    const view = getAchievementView(achievement, progress);

    const card = el("div", "achievement-card");
    if (view.unlocked) card.classList.add("unlocked");

    const head = el("div", "achievement-card-head");
    head.appendChild(el("span", "achievement-icon", view.icon));

    const titleBlock = el("div", "achievement-titles");
    titleBlock.appendChild(el("div", "achievement-name", view.name));
    titleBlock.appendChild(el("div", "achievement-description", view.description));
    head.appendChild(titleBlock);

    card.appendChild(head);

    const footer = el("div", "achievement-card-footer");
    const tierBadge = el("span", `achievement-tier tier-${view.tier}`, `${view.tierIcon} ${view.tierLabel}`);
    footer.appendChild(tierBadge);
    footer.appendChild(el("span", "achievement-reward", `+${view.exp} EXP · 🪙 +${view.points}`));
    card.appendChild(footer);

    if (view.unlocked) {
        card.appendChild(el("div", "achievement-status", "✓ Débloqué"));
    } else if (view.progress) {
        const bar = buildBar(Math.min(1, view.progress.current / view.progress.target), "achievement-progress-bar");
        card.appendChild(bar);
        card.appendChild(el("div", "achievement-progress-text", `${formatNumber(view.progress.current)} / ${formatNumber(view.progress.target)}`));
    } else {
        card.appendChild(el("div", "achievement-status locked", "🔒 Non débloqué"));
    }

    return card;
}

function renderAchievements() {
    if (document.getElementById("achievements-popup")?.style.display !== "flex") return;

    renderAchievementTabs();

    const summaryInfo = getAchievementsSummary(progress);
    const summary = document.getElementById("achievements-summary");
    if (summary) {
        summary.innerHTML = "";
        summary.appendChild(el("span", "", `${summaryInfo.unlockedCount} / ${summaryInfo.totalCount} débloqués`));
        summary.appendChild(buildBar(summaryInfo.totalCount ? summaryInfo.unlockedCount / summaryInfo.totalCount : 0, "achievements-summary-bar"));
    }

    const body = document.getElementById("achievements-body");
    if (!body) return;

    const previousScroll = body.scrollTop;
    body.innerHTML = "";

    const items = ACHIEVEMENTS.filter(achievement => achievement.category === achievementsCategory);
    const grid = el("div", "achievements-grid");
    items.forEach(achievement => grid.appendChild(buildAchievementCard(achievement)));
    body.appendChild(grid);

    body.scrollTop = previousScroll;
}

// ---------------------------------------------------------------------------
// AFFICHAGE : RÉCOMPENSES DANS L'ÉCRAN DE FIN DE PARTIE
// ---------------------------------------------------------------------------

export function clearGameReward() {
    document.getElementById("game-reward")?.remove();
}

// Libellé de la ligne "bonus de place" du récapitulatif
function getPlaceLabel(rank, totalPlayers) {
    if (rank === 1) return "🏆 Victoire";

    const medal = rank === 2 ? "🥈" : rank === 3 ? "🥉" : "🏅";
    return `${medal} ${rank}e place sur ${totalPlayers}`;
}

function renderGameReward(result) {
    const box = document.getElementById("winner-message-box");
    if (!box) return;

    let container = document.getElementById("game-reward");
    if (!container) {
        container = el("div", "");
        container.id = "game-reward";
        // Juste avant les boutons de l'hôte (Relancer / Retour au salon)
        const actions = document.getElementById("winner-actions");
        box.insertBefore(container, actions && actions.parentNode === box ? actions : null);
    }
    container.innerHTML = "";

    if (result.status === "notEnoughPlayers") {
        container.appendChild(el("p", "game-reward-note", "ℹ️ Il faut au moins 2 joueurs pour gagner de l'EXP."));
        return;
    }

    if (result.status === "tooShort") {
        container.appendChild(el("p", "game-reward-note", "⏱️ Partie trop courte pour gagner de l'EXP."));
        return;
    }

    const s = result.summary;

    container.appendChild(el("h4", "", "✨ Récompenses"));

    const addRow = (label, value, className) => {
        const row = el("div", `game-reward-row ${className || ""}`);
        row.appendChild(el("span", "", label));
        row.appendChild(el("span", "", value));
        container.appendChild(row);
    };

    const achievementExp = (s.newAchievements || []).reduce((sum, a) => sum + a.exp, 0);
    const totalExp = s.reward.total + achievementExp;

    addRow("🎴 Partie jouée", `+${s.reward.played} EXP`);
    if (s.reward.placeBonus > 0) {
        addRow(getPlaceLabel(s.rank, s.totalPlayers), `+${s.reward.placeBonus} EXP`);
    }
    if (achievementExp > 0) {
        addRow("🏆 Succès débloqués", `+${achievementExp} EXP`);
    }
    addRow("Total", `+${totalExp} EXP`, "game-reward-total");

    // Barre : part de l'ancienne position (ou de 0 si on a changé de niveau) vers la nouvelle
    const newInfo = getLevelProgress(s.newExp);
    const startRatio = s.levelsGained > 0 ? 0 : getLevelProgress(s.oldExp).ratio;
    const bar = buildBar(startRatio, "game-reward-bar");
    container.appendChild(bar);

    const fill = bar.firstChild;
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            fill.style.width = `${Math.round(newInfo.ratio * 100)}%`;
        });
    });

    container.appendChild(el(
        "div",
        "game-reward-level",
        `⭐ Niveau ${newInfo.level} — ${formatNumber(newInfo.expInLevel)} / ${formatNumber(newInfo.expNeeded)} EXP`
    ));

    if (s.levelsGained > 0) {
        const banner = el("div", "game-reward-levelup");
        banner.appendChild(el("div", "game-reward-levelup-title", `🎉 Niveau ${s.newLevel} atteint !`));
        banner.appendChild(el("div", "", `🪙 +${s.pointsGained} points DUO`));
        s.newSkins.forEach(skin => {
            banner.appendChild(el("div", "game-reward-skin", `🎨 Nouveau skin débloqué : ${skin.name}`));
        });
        container.appendChild(banner);
    }

    if (s.newAchievements?.length > 0) {
        const banner = el("div", "game-reward-achievements");
        const plural = s.newAchievements.length > 1 ? "s" : "";
        banner.appendChild(el("div", "game-reward-achievements-title", `🏆 Succès débloqué${plural} !`));
        s.newAchievements.forEach(achievement => {
            banner.appendChild(el(
                "div",
                "game-reward-achievement",
                `${achievement.icon} ${achievement.name} — +${achievement.exp} EXP, +${achievement.points} pts DUO`
            ));
        });
        if (s.achievementPoints > 0) {
            banner.appendChild(el("div", "", `🪙 +${s.achievementPoints} points DUO au total`));
        }
        container.appendChild(banner);
    }
}