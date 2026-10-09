// skins.js - Paquets de cartes (skins) et barre de personnalisation
//
// Vocabulaire :
//  - un "deck" (paquet) correspond à un mode de jeu : "duo" ou "duo-no-mercy"
//  - un "skin" est une apparence pour un deck (un dossier d'images de cartes)
//
// Pour AJOUTER un skin plus tard : ajoute simplement un objet dans SKINS ci-dessous
// (avec son dossier d'images). La barre de personnalisation l'affichera toute seule.

import { getCardImageName as getNoMercyCardImageName } from "./game/duo-no-mercy.js";

const STORAGE_EQUIPPED = "duo-equipped-skins"; // { "duo": "duo-base", ... }
const STORAGE_OWNED = "duo-owned-skins";       // ["id-d-un-skin-debloque", ...]

// ---------------------------------------------------------------------------
// DECKS (un par mode de jeu)
// ---------------------------------------------------------------------------

// Nom de fichier (sans dossier ni extension) d'une carte du paquet DUO
function duoCardFileName(card) {
    switch (card.type) {
        case "number": return `${card.color}-${card.value}`;
        case "skip": return `${card.color}-skip`;
        case "reverse": return `${card.color}-reverse`;
        case "draw2": return `${card.color}-draw2`;
        case "wild": return "wild";
        case "draw4": return "draw4";
        default: return null;
    }
}

export const DECKS = {
    "duo": {
        name: "DUO",
        logo: "images/duo-logo.webp",
        defaultSkinId: "duo-base",
        getCardFileName: duoCardFileName
    },
    "duo-no-mercy": {
        name: "DUO No Mercy",
        logo: "images/duo-no-mercy.webp",
        defaultSkinId: "no-mercy-base",
        getCardFileName: getNoMercyCardImageName
    }
};

// ---------------------------------------------------------------------------
// SKINS
// ---------------------------------------------------------------------------
//  id          : identifiant unique (sert à la sauvegarde)
//  deck        : "duo" ou "duo-no-mercy"
//  name        : nom affiché
//  description : phrase affichée sous le nom
//  folder      : dossier des images (avec le "/" final)
//  extension   : extension des images (défaut : "webp")
//  unlock      : "default" = tout le monde l'a ; "level" = récompense de niveau
//  unlockLevel : (unlock "level") niveau à atteindre pour le débloquer
//  unlockHint  : (skins verrouillés) texte expliquant comment l'obtenir
//  preview     : noms de fichiers des cartes montrées en aperçu
//  back        : (optionnel) nom du fichier de dos de carte, "back" par défaut
//                (utilisé en aperçu dans la fenêtre Niveaux)

export const SKINS = [
    {
        id: "duo-base",
        deck: "duo",
        name: "DUO",
        description: "Le paquet de base, disponible pour tous les joueurs.",
        folder: "images/duo/",
        extension: "webp",
        unlock: "default",
        preview: ["red-7", "blue-reverse", "green-draw2", "draw4"]
    },
    {
        id: "duo-black",
        deck: "duo",
        name: "DUO Noir",
        description: "Les cartes basiques, mais en noir.",
        folder: "images/duo/black/",
        extension: "webp",
        unlock: "default",
        preview: ["red-5", "blue-reverse", "green-draw2", "draw4"]
    },
    {
        id: "duo-minimalist",
        deck: "duo",
        name: "DUO Minimalist",
        description: "Un paquet épuré.",
        folder: "images/duo/minimalist/",
        extension: "webp",
        unlock: "level",          // récompense du niveau 5
        unlockLevel: 5,
        unlockHint: "Atteins le niveau 5",
        preview: ["red-7", "blue-reverse", "green-draw2", "draw4"]
    },
    {
        id: "no-mercy-base",
        deck: "duo-no-mercy",
        name: "DUO No Mercy",
        description: "Le paquet de base du mode No Mercy.",
        folder: "images/duo-no-mercy/",
        extension: "webp",
        unlock: "default",
        preview: ["red-7", "blue-draw4", "draw6", "roulette"]
    },
    {
        id: "no-mercy-minimalist",
        deck: "duo-no-mercy",
        name: "DUO No Mercy Minimalist",
        description: "Un paquet épuré pour le mode No Mercy.",
        folder: "images/duo-no-mercy/minimalist/",
        extension: "webp",
        unlock: "level",
        unlockLevel: 10,
        unlockHint: "Atteins le niveau 10",
        preview: ["red-7", "blue-draw4", "draw6", "roulette"]
    }
];

// ---------------------------------------------------------------------------
// STOCKAGE (localStorage)
// ---------------------------------------------------------------------------

function readStorage(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
        return fallback;
    }
}

function writeStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.error("Impossible de sauvegarder :", error);
    }
}

// ---------------------------------------------------------------------------
// LOGIQUE DES SKINS
// ---------------------------------------------------------------------------

export function getSkinsForDeck(deckId) {
    return SKINS.filter(skin => skin.deck === deckId);
}

// Skins possédés. La source de vérité est Firebase (remplie par progress.js) ;
// la copie locale sert juste à afficher tout de suite au chargement de la page.
let ownedSkinIds = new Set(readStorage(STORAGE_OWNED, []));

// Remplace la liste des skins possédés (appelé par progress.js après lecture de Firebase)
export function setOwnedSkins(skinIds) {
    ownedSkinIds = new Set(skinIds);
    writeStorage(STORAGE_OWNED, [...ownedSkinIds]);
    renderSkinSidebar();
}

// Le skin est-il utilisable par le joueur ?
export function isSkinUnlocked(skin) {
    return skin.unlock === "default" || ownedSkinIds.has(skin.id);
}

// Débloque un skin localement
export function unlockSkin(skinId) {
    ownedSkinIds.add(skinId);
    writeStorage(STORAGE_OWNED, [...ownedSkinIds]);
    renderSkinSidebar();
}

// Skin actuellement équipé pour un deck (retombe sur le skin de base si besoin)
export function getEquippedSkin(deckId) {
    const equipped = readStorage(STORAGE_EQUIPPED, {});
    const skins = getSkinsForDeck(deckId);

    const chosen = skins.find(skin => skin.id === equipped[deckId] && isSkinUnlocked(skin));
    if (chosen) return chosen;

    const defaultSkinId = DECKS[deckId]?.defaultSkinId;
    return skins.find(skin => skin.id === defaultSkinId) || skins[0] || null;
}

// Équipe un skin. Retourne false s'il n'existe pas ou n'est pas débloqué.
export function setEquippedSkin(deckId, skinId) {
    const skin = getSkinsForDeck(deckId).find(s => s.id === skinId);
    if (!skin || !isSkinUnlocked(skin)) return false;

    const equipped = readStorage(STORAGE_EQUIPPED, {});
    equipped[deckId] = skinId;
    writeStorage(STORAGE_EQUIPPED, equipped);
    return true;
}

// Chemin de l'image d'une carte, selon le deck (mode) et le skin équipé
export function getCardImagePath(deckId, card) {
    const deck = DECKS[deckId];
    const skin = getEquippedSkin(deckId);
    if (!deck || !skin) return null;

    const fileName = deck.getCardFileName(card);
    if (!fileName) return null;

    return `${skin.folder}${fileName}.${skin.extension || "webp"}`;
}

// ---------------------------------------------------------------------------
// BARRE DE PERSONNALISATION (à droite de l'écran)
// ---------------------------------------------------------------------------

function el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

let onSkinChange = null;

function buildSkinOption(deckId, skin, isEquipped) {
    const unlocked = isSkinUnlocked(skin);

    const option = el("button", "skin-option");
    option.type = "button";
    option.disabled = !unlocked;
    if (isEquipped) option.classList.add("equipped");
    if (!unlocked) option.classList.add("locked");
    option.setAttribute("aria-pressed", String(isEquipped));

    // Aperçu : quelques cartes du paquet
    const preview = el("div", "skin-preview");
    (skin.preview || []).forEach(fileName => {
        const img = document.createElement("img");
        img.src = `${skin.folder}${fileName}.${skin.extension || "webp"}`;
        img.alt = "";
        img.loading = "lazy";
        img.addEventListener("error", () => img.remove()); // image absente : on la cache
        preview.appendChild(img);
    });
    option.appendChild(preview);

    option.appendChild(el("div", "skin-name", skin.name));
    if (skin.description) option.appendChild(el("div", "skin-description", skin.description));

    let badge = "Équiper";
    if (isEquipped) badge = "✓ Équipé";
    else if (!unlocked) badge = `🔒 ${skin.unlockHint || "Verrouillé"}`;
    option.appendChild(el("div", "skin-badge", badge));

    option.addEventListener("click", () => {
        if (!setEquippedSkin(deckId, skin.id)) return;
        renderSkinSidebar();
        if (onSkinChange) onSkinChange(deckId, skin);
    });

    return option;
}

function renderSkinSidebar() {
    const body = document.getElementById("skin-sidebar-body");
    if (!body) return;
    body.innerHTML = "";

    Object.entries(DECKS).forEach(([deckId, deck]) => {
        const section = el("section", "skin-deck");

        const header = el("div", "skin-deck-header");
        const logo = document.createElement("img");
        logo.src = deck.logo;
        logo.alt = "";
        logo.addEventListener("error", () => logo.remove());
        header.appendChild(logo);
        header.appendChild(el("h3", "", `Paquets ${deck.name}`));
        section.appendChild(header);

        const equipped = getEquippedSkin(deckId);
        getSkinsForDeck(deckId).forEach(skin => {
            section.appendChild(buildSkinOption(deckId, skin, equipped && equipped.id === skin.id));
        });

        section.appendChild(el("p", "skin-coming-soon", "🔒 D'autres paquets arriveront bientôt…"));
        body.appendChild(section);
    });
}

function setSidebarOpen(open) {
    const sidebar = document.getElementById("skin-sidebar");
    const toggle = document.getElementById("skin-sidebar-toggle");
    if (!sidebar || !toggle) return;

    sidebar.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
}

// Crée la barre de personnalisation.
// options.onChange(deckId, skin) est appelé quand le joueur équipe un skin
// (utile pour rafraîchir les cartes déjà affichées).
export function initSkinSidebar(options = {}) {
    if (document.getElementById("skin-sidebar")) return;
    onSkinChange = options.onChange || null;

    const sidebar = el("aside", "");
    sidebar.id = "skin-sidebar";

    const toggle = el("button", "", "🎨");
    toggle.id = "skin-sidebar-toggle";
    toggle.type = "button";
    toggle.title = "Personnaliser les cartes";
    toggle.setAttribute("aria-label", "Personnaliser les cartes");
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", () => {
        setSidebarOpen(!sidebar.classList.contains("open"));
    });

    const panel = el("div", "");
    panel.id = "skin-sidebar-panel";

    const header = el("div", "");
    header.id = "skin-sidebar-header";
    header.appendChild(el("h2", "", "🎨 Personnalisation"));

    const closeButton = el("button", "", "✕");
    closeButton.id = "skin-sidebar-close";
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Fermer");
    closeButton.addEventListener("click", () => setSidebarOpen(false));
    header.appendChild(closeButton);

    const body = el("div", "");
    body.id = "skin-sidebar-body";

    panel.append(header, body);
    sidebar.append(toggle, panel);
    document.body.appendChild(sidebar);

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") setSidebarOpen(false);
    });

    renderSkinSidebar();
}