// progress.js - Progression du joueur (EXP, niveau, points DUO, skins débloqués)
//
// Les données sont stockées dans Firebase : users/<uid>/progress
// (tes règles actuelles autorisent déjà chaque joueur à écrire dans son propre users/<uid>)

import {
    ref,
    onValue,
    runTransaction
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";

import { setOwnedSkins, DECKS } from "./skins.js";

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

    onValue(ref(db, ".info/serverTimeOffset"), (snapshot) => {
        serverOffset = snapshot.val() || 0;
    });

    onValue(ref(db, `users/${uid}/progress`), (snapshot) => {
        progress = { ...createEmptyProgress(), ...(snapshot.val() || {}) };

        // Les skins débloqués par niveau deviennent utilisables
        setOwnedSkins(Object.keys(progress.unlockedSkins || {}));

        renderProgressUI();
    });

    renderProgressUI();
}

// ---------------------------------------------------------------------------
// FIN DE PARTIE : ATTRIBUTION DE L'EXP
// ---------------------------------------------------------------------------

// À appeler à chaque mise à jour de la salle (depuis le listener de script.js)
export function handleRoomProgress(room, myId) {
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

    awardGameEnd({ gameId, rank, totalPlayers })
        .then(summary => {
            if (summary) renderGameReward({ status: "rewarded", summary });
        })
        .catch(error => console.error("Impossible d'enregistrer l'EXP :", error));
}

// Crédite l'EXP dans Firebase. La transaction garantit qu'une même partie
// ne peut jamais être créditée deux fois (même en rechargeant la page).
async function awardGameEnd({ gameId, rank, totalPlayers }) {
    if (!db || !uid) return null;

    let summary = null;

    const result = await runTransaction(ref(db, `users/${uid}/progress`), (current) => {
        if (current && current.lastRewardedGame === gameId) {
            return; // déjà crédité : on annule
        }

        const applied = applyGameReward(current, { rank, totalPlayers, gameId });
        summary = applied.summary;
        return applied.progress;
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

// Quand on ouvre "Personnalisation", on ferme "Niveaux" (elles sont au même endroit)
function linkSkinSidebar() {
    if (skinSidebarLinked) return;
    const skinToggle = document.getElementById("skin-sidebar-toggle");
    if (!skinToggle) return;

    skinToggle.addEventListener("click", () => setLevelsOpen(false));
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

    addRow("🎴 Partie jouée", `+${s.reward.played} EXP`);
    if (s.reward.placeBonus > 0) {
        addRow(getPlaceLabel(s.rank, s.totalPlayers), `+${s.reward.placeBonus} EXP`);
    }
    addRow("Total", `+${s.reward.total} EXP`, "game-reward-total");

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
}