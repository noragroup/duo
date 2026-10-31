// skins.js - Paquets de cartes (skins) et barre de personnalisation
//
// Vocabulaire :
//  - un "deck" (paquet) correspond à un mode de jeu : "duo", "duo-no-mercy" ou "duo-flip"
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
    },
    // Mode pas encore créé : il a déjà son onglet dans la personnalisation
    "duo-flip": {
        name: "DUO Flip",
        logo: "images/duo-flip.webp",
        comingSoon: true,
        getCardFileName: () => null
    }
};

// ---------------------------------------------------------------------------
// SKINS
// ---------------------------------------------------------------------------
//  id          : identifiant unique (sert à la sauvegarde)
//  deck        : "duo", "duo-no-mercy" ou "duo-flip"
//  name        : nom affiché
//  description : phrase affichée sous le nom
//  folder      : dossier des images (avec le "/" final)
//  extension   : extension des images (défaut : "webp")
//  unlock      : "default" = tout le monde l'a ; "level" = récompense de niveau ;
//                "shop" = s'achète en boutique avec des points DUO
//  unlockLevel : (unlock "level") niveau à atteindre pour le débloquer
//  unlockHint  : (skins verrouillés) texte expliquant comment l'obtenir
//  price       : (unlock "shop") prix en points DUO
//  parent      : (variante) id du skin de base. La variante s'affiche dans la carte de
//                son skin de base et ne peut être achetée que si on possède ce dernier
//  variantName : (variante) nom court affiché sur le bouton de la variante (ex : "Négatif")
//  preview     : noms de fichiers des cartes montrées en aperçu
//  back        : (optionnel) nom du fichier de dos de carte, "back" par défaut
//                (utilisé en aperçu dans la fenêtre Niveaux)
//  negative    : true si c'est un skin "négatif" (couleurs inversées). Sert à inverser
//                aussi la couleur de fond qui indique la couleur en cours (voir isSkinNegative)

export const SKINS = [

    // ----- Paquets DUO -----
    {
        id: "duo-base",
        deck: "duo",
        name: "DUO Basique",
        description: "Le paquet de base, disponible pour tous les joueurs.",
        folder: "images/duo/",
        extension: "webp",
        unlock: "default",
        preview: ["red-7", "blue-reverse", "green-draw2", "draw4"]
    },
    {
        id: "duo-black",
        deck: "duo",
        parent: "duo-base",
        name: "DUO Noir",
        description: "Les cartes basiques, mais en noir.",
        folder: "images/duo/black/",
        extension: "webp",
        unlock: "default",
        preview: ["red-5", "blue-reverse", "green-draw2", "draw4"]
    },
    {
        id: "duo-negative",
        deck: "duo",
        negative: true,
        parent: "duo-base",
        name: "DUO Négatif",
        description: "Les couleurs inversées, comme un négatif photo.",
        folder: "images/duo/negative/",
        extension: "webp",
        unlock: "level",
        unlockLevel: 15,
        unlockHint: "Atteins le niveau 15",
        preview: ["red-7", "blue-reverse", "green-draw2", "draw4"]
    },
    {
        id: "duo-minimalist",
        deck: "duo",
        name: "DUO Minimalist",
        description: "Un paquet épuré.",
        folder: "images/duo/minimalist/",
        extension: "webp",
        unlock: "level", 
        unlockLevel: 5,
        unlockHint: "Atteins le niveau 5",
        preview: ["red-7", "blue-reverse", "green-draw2", "draw4"]
    },
    {
        id: "duo-minimalist-negative",
        deck: "duo",
        parent: "duo-minimalist",
        variantName: "Négatif",
        negative: true,
        name: "DUO Minimalist Négatif",
        description: "DUO Minimalist, avec les couleurs inversées.",
        folder: "images/duo/minimalist/negative/",
        extension: "webp",
        unlock: "shop",
        price: 50,
        unlockHint: "Achetable dans la boutique",
        preview: ["red-7", "blue-reverse", "green-draw2", "draw4"]
    },
    {
        id: "duo-gradient",
        deck: "duo",
        name: "DUO Gradient",
        description: "Des cartes aux dégradés de couleurs.",
        folder: "images/duo/gradient/",
        extension: "webp",
        unlock: "shop",
        price: 300,
        unlockHint: "Achetable dans la boutique",
        preview: ["red-7", "blue-reverse", "green-draw2", "draw4"]
    },
    {
        id: "duo-vintage",
        deck: "duo",
        name: "DUO Vintage",
        description: "Un paquet qui rappelle l'ancien temps.",
        folder: "images/duo/vintage/",
        extension: "webp",
        unlock: "level",
        unlockLevel: 20,
        unlockHint: "Atteins le niveau 20",
        preview: ["red-7", "blue-reverse", "green-draw2", "draw4"]
    },
    {
        id: "duo-vintage-negative",
        deck: "duo",
        negative: true,
        parent: "duo-vintage",
        name: "DUO Vintage Négatif",
        description: "DUO Vintage, avec les couleurs inversées.",
        folder: "images/duo/vintage/negative/",
        extension: "webp",
        unlock: "shop",
        price: 50,
        unlockHint: "Achetable dans la boutique",
        preview: ["red-7", "blue-reverse", "green-draw2", "draw4"]
    },

    // ----- Paquets DUO No Mercy -----
    {
        id: "no-mercy-base",
        deck: "duo-no-mercy",
        name: "DUO No Mercy Basique",
        description: "Le paquet de base du mode No Mercy.",
        folder: "images/duo-no-mercy/",
        extension: "webp",
        unlock: "default",
        preview: ["red-7", "blue-draw4", "draw6", "roulette"]
    },
    {
        id: "no-mercy-white",
        deck: "duo-no-mercy",
        parent: "no-mercy-base",
        name: "DUO No Mercy Blanc",
        description: "Les cartes basiques, mais en blanc.",
        folder: "images/duo-no-mercy/white/",
        extension: "webp",
        unlock: "default",
        preview: ["red-7", "blue-draw4", "draw6", "roulette"]
    },
    {
        id: "no-mercy-negative",
        deck: "duo-no-mercy",
        negative: true,
        parent: "no-mercy-base",
        name: "DUO No Mercy Négatif",
        description: "Les couleurs inversées, comme un négatif photo.",
        folder: "images/duo-no-mercy/negative/",
        extension: "webp",
        unlock: "level",
        unlockLevel: 15,
        unlockHint: "Atteins le niveau 10",
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
    },
    {
        id: "no-mercy-minimalist-negative",
        negative: true,
        deck: "duo-no-mercy",
        parent: "no-mercy-minimalist",
        name: "DUO No Mercy Minimalist",
        description: "DUO No Mercy Minimalist, mais avec les couleurs inversées.",
        folder: "images/duo-no-mercy/minimalist/negative/",
        extension: "webp",
        unlock: "shop",
        price: 50,
        unlockHint: "Achetable dans la boutique",
        preview: ["red-7", "blue-draw4", "draw6", "roulette"]
    },
    {
        id: "no-mercy-gradient",
        deck: "duo-no-mercy",
        name: "DUO No Mercy Gradient",
        description: "Des cartes aux dégradés de couleurs.",
        folder: "images/duo-no-mercy/gradient/",
        extension: "webp",
        unlock: "shop",
        price: 300,
        unlockHint: "Achetable dans la boutique",
        preview: ["red-7", "blue-draw4", "draw6", "roulette"]
    },
    {
        id: "no-mercy-vintage",
        deck: "duo-no-mercy",
        name: "DUO No Mercy Vintage",
        description: "Un paquet qui rappelle l'ancien temps.",
        folder: "images/duo-no-mercy/vintage/",
        extension: "webp",
        unlock: "level",
        unlockLevel: 20,
        unlockHint: "Atteins le niveau 20",
        preview: ["red-7", "blue-draw4", "draw6", "roulette"]
    },
    {
        id: "no-mercy-vintage-negative",
        deck: "duo-no-mercy",
        negative: true,
        parent: "no-mercy-vintage",
        name: "DUO No Mercy Vintage Négatif",
        description: "DUO No Mercy Vintage, avec les couleurs inversées.",
        folder: "images/duo-no-mercy/vintage/negative/",
        extension: "webp",
        unlock: "shop",
        price: 50,
        unlockHint: "Achetable dans la boutique",
        preview: ["red-7", "blue-draw4", "draw6", "roulette"]
    },
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

// Le skin équipé pour ce jeu est-il un skin "négatif" (couleurs inversées) ?
export function isSkinNegative(deckId) {
    return !!getEquippedSkin(deckId)?.negative;
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

// Onglet (jeu) actuellement affiché dans la barre de personnalisation
let activeSkinDeckId = "duo";

// Dernier style utilisé dans chaque famille de skin (id du skin de base -> id du skin)
const viewedVariants = {};

// Skin de base mis en avant pour chaque jeu (id du jeu -> id du skin de base)
const selectedRoots = {};

// Liste déroulante des variantes ouverte (id du skin de base) ou null
let openVariantMenuId = null;

// Affiche les paquets d'un jeu (ex : setSkinSidebarDeck("duo-no-mercy"))
export function setSkinSidebarDeck(deckId) {
    if (!DECKS[deckId]) return;
    activeSkinDeckId = deckId;
    openVariantMenuId = null;
    renderSkinSidebar();

    const body = document.getElementById("skin-sidebar-body");
    if (body) body.scrollTop = 0;
}

// Le skin de base d'un skin (lui-même s'il n'est pas une variante)
function getRootOf(skin) {
    return skin.parent ? (SKINS.find(s => s.id === skin.parent) || skin) : skin;
}

// Équipe un skin et prévient le reste du site (cartes déjà affichées...).
// Utilisable aussi depuis d'autres fenêtres. Retourne false si le skin n'est pas possédé.
export function equipSkin(deckId, skinId) {
    if (!setEquippedSkin(deckId, skinId)) return false;

    const skin = SKINS.find(s => s.id === skinId);
    if (skin) {
        const root = getRootOf(skin);
        selectedRoots[deckId] = root.id;
        viewedVariants[root.id] = skin.id;
    }
    openVariantMenuId = null;

    renderSkinSidebar();
    if (onSkinChange) onSkinChange(deckId, skin);
    return true;
}

// Prépare le panneau pour qu'il s'ouvre sur ce skin (utilisé après un achat), sans l'équiper
export function focusSkin(skinId) {
    const skin = SKINS.find(s => s.id === skinId);
    if (!skin || !DECKS[skin.deck]) return;

    activeSkinDeckId = skin.deck;
    selectedRoots[skin.deck] = getRootOf(skin).id;
    openVariantMenuId = null;
    renderSkinSidebar();
}

// Skins de base d'un jeu (ceux qui ne sont pas des variantes).
// Un skin de boutique n'apparaît ici qu'une fois acheté.
function getRootSkins(deckId) {
    return getSkinsForDeck(deckId).filter(skin =>
        !skin.parent && (skin.unlock !== "shop" || isSkinUnlocked(skin))
    );
}

function getVariants(rootSkin) {
    return SKINS.filter(skin => skin.parent === rootSkin.id);
}

// Le skin de base + ses variantes possédées (les variantes demandent d'avoir le skin de base)
function getFamily(root) {
    if (!isSkinUnlocked(root)) return [root];
    return [root, ...getVariants(root).filter(isSkinUnlocked)];
}

// Style montré pour une famille : celui qui est équipé, sinon le dernier utilisé, sinon le skin de base
function getDisplayedSkin(deckId, root, family) {
    const equipped = getEquippedSkin(deckId);
    return (
        family.find(skin => equipped && skin.id === equipped.id) ||
        family.find(skin => skin.id === viewedVariants[root.id]) ||
        root
    );
}

// Skin de base mis en avant en haut du panneau
function getSelectedRoot(deckId, roots) {
    const equipped = getEquippedSkin(deckId);
    const equippedRoot = equipped ? getRootOf(equipped) : null;

    return (
        roots.find(root => root.id === selectedRoots[deckId]) ||
        roots.find(root => equippedRoot && root.id === equippedRoot.id) ||
        roots[0] ||
        null
    );
}

function getStyleLabel(skin) {
    return skin.parent ? (skin.variantName || skin.name) : "Normal";
}

// Ouvre la fenêtre Boutique (créée par progress.js)
function openShop() {
    document.getElementById("shop-sidebar-toggle")?.click();
}

function buildPreviewImages(skin, count) {
    const preview = el("div", "skin-preview");
    (skin.preview || []).slice(0, count).forEach(fileName => {
        const img = document.createElement("img");
        img.src = `${skin.folder}${fileName}.${skin.extension || "webp"}`;
        img.alt = "";
        img.loading = "lazy";
        img.addEventListener("error", () => img.remove()); // image absente : on la cache
        preview.appendChild(img);
    });
    return preview;
}

// Un tap sur une tuile : un skin possédé est équipé tout de suite (avec son dernier style),
// un skin verrouillé est juste mis en avant pour voir comment l'obtenir.
function selectRoot(deckId, root) {
    selectedRoots[deckId] = root.id;
    openVariantMenuId = null;

    if (isSkinUnlocked(root)) {
        const equipped = getEquippedSkin(deckId);
        if (equipped && getRootOf(equipped).id === root.id) {
            renderSkinSidebar();       // déjà équipé : on met juste l'affichage à jour
            return;
        }

        const family = getFamily(root);
        const target = family.find(skin => skin.id === viewedVariants[root.id]) || root;
        equipSkin(deckId, target.id);
    } else {
        renderSkinSidebar();
    }
}

// Liste déroulante "Variante : Normal ▾" (seulement si on possède au moins une variante)
function buildVariantDropdown(deckId, root, family, displayed) {
    const isOpen = openVariantMenuId === root.id;

    const dropdown = el("div", "skin-dropdown");
    if (isOpen) dropdown.classList.add("open");

    const toggle = el("button", "skin-dropdown-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-haspopup", "listbox");
    toggle.setAttribute("aria-expanded", String(isOpen));
    toggle.appendChild(el("span", "skin-dropdown-label", "Variante"));
    toggle.appendChild(el("span", "skin-dropdown-value", getStyleLabel(displayed)));
    toggle.appendChild(el("span", "skin-dropdown-arrow", "▾"));
    toggle.addEventListener("click", () => {
        openVariantMenuId = isOpen ? null : root.id;
        renderSkinSidebar();
    });
    dropdown.appendChild(toggle);

    const list = el("div", "skin-dropdown-list");
    list.setAttribute("role", "listbox");
    family.forEach(skin => {
        const active = skin.id === displayed.id;

        const option = el("button", "skin-dropdown-option", getStyleLabel(skin));
        option.type = "button";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(active));
        if (active) option.classList.add("active");
        option.addEventListener("click", () => equipSkin(deckId, skin.id));
        list.appendChild(option);
    });
    dropdown.appendChild(list);

    return dropdown;
}

// Grand aperçu du skin sélectionné : cartes, nom, état, variantes
function buildSkinHero(deckId, root) {
    const family = getFamily(root);
    const displayed = getDisplayedSkin(deckId, root, family);
    const unlocked = isSkinUnlocked(root);
    const equipped = getEquippedSkin(deckId);
    const isEquipped = !!equipped && equipped.id === displayed.id;

    const hero = el("div", "skin-hero");
    if (isEquipped) hero.classList.add("equipped");
    if (!unlocked) hero.classList.add("locked");

    hero.appendChild(buildPreviewImages(displayed, 4));

    hero.appendChild(el("div", "skin-hero-name", displayed.name));
    if (displayed.description) hero.appendChild(el("div", "skin-description", displayed.description));

    if (isEquipped) {
        hero.appendChild(el("div", "skin-badge skin-badge-equipped", "✓ Équipé"));
    } else if (!unlocked) {
        hero.appendChild(el("div", "skin-badge", `🔒 ${root.unlockHint || "Verrouillé"}`));
    } else {
        const equip = el("button", "skin-hero-equip", "Équiper ce paquet");
        equip.type = "button";
        equip.addEventListener("click", () => equipSkin(deckId, displayed.id));
        hero.appendChild(equip);
    }

    if (family.length > 1) {
        hero.appendChild(buildVariantDropdown(deckId, root, family, displayed));
    }

    // Variantes encore à acheter : un lien vers la boutique
    const forSale = getVariants(root).filter(v => v.unlock === "shop" && !isSkinUnlocked(v));
    if (unlocked && forSale.length > 0) {
        const plural = forSale.length > 1 ? "s" : "";
        const link = el("button", "skin-shop-link", `🛒 ${forSale.length} variante${plural} en boutique`);
        link.type = "button";
        link.addEventListener("click", openShop);
        hero.appendChild(link);
    }

    return hero;
}

// Une tuile de la grille = un skin de base (ses variantes sont dans la liste déroulante)
function buildSkinTile(deckId, root, selectedRoot) {
    const family = getFamily(root);
    const displayed = getDisplayedSkin(deckId, root, family);
    const unlocked = isSkinUnlocked(root);
    const equipped = getEquippedSkin(deckId);
    const isEquipped = !!equipped && family.some(skin => skin.id === equipped.id);

    const tile = el("button", "skin-tile");
    tile.type = "button";
    tile.setAttribute("aria-pressed", String(isEquipped));
    if (isEquipped) tile.classList.add("equipped");
    if (selectedRoot && root.id === selectedRoot.id) tile.classList.add("selected");
    if (!unlocked) tile.classList.add("locked");

    tile.appendChild(buildPreviewImages(displayed, 3));
    tile.appendChild(el("div", "skin-tile-name", root.name));

    let state = "Équiper";
    if (isEquipped) state = "✓ Équipé";
    else if (!unlocked) state = root.unlockLevel ? `🔒 Niveau ${root.unlockLevel}` : "🔒 Verrouillé";
    tile.appendChild(el("div", "skin-tile-state", state));

    if (family.length > 1) {
        tile.appendChild(el("div", "skin-tile-extra", `${family.length} styles`));
    }

    tile.addEventListener("click", () => selectRoot(deckId, root));
    return tile;
}

// Boutons du haut : un onglet par jeu
function renderSkinTabs() {
    const tabs = document.getElementById("skin-sidebar-tabs");
    if (!tabs) return;
    tabs.innerHTML = "";

    Object.entries(DECKS).forEach(([deckId, deck]) => {
        const tab = el("button", "skin-tab", deck.name);
        tab.type = "button";
        tab.setAttribute("role", "tab");

        const isActive = deckId === activeSkinDeckId;
        tab.setAttribute("aria-selected", String(isActive));
        if (isActive) tab.classList.add("active");
        if (deck.comingSoon) tab.classList.add("coming-soon");

        tab.addEventListener("click", () => setSkinSidebarDeck(deckId));
        tabs.appendChild(tab);
    });
}

// Contenu du jeu sélectionné : grand aperçu + grille compacte
function renderSkinSidebar() {
    renderSkinTabs();

    const body = document.getElementById("skin-sidebar-body");
    if (!body) return;

    const previousScroll = body.scrollTop;
    body.innerHTML = "";

    const deckId = activeSkinDeckId;
    const deck = DECKS[deckId];
    if (!deck) return;

    const section = el("section", "skin-deck");

    if (deck.comingSoon) {
        section.appendChild(el(
            "p",
            "skin-deck-placeholder",
            "🚧 Ce mode est en développement : ses paquets de cartes arriveront avec lui."
        ));
        body.appendChild(section);
        return;
    }

    const roots = getRootSkins(deckId);
    const selected = getSelectedRoot(deckId, roots);

    if (selected) section.appendChild(buildSkinHero(deckId, selected));

    const owned = roots.filter(isSkinUnlocked).length;
    section.appendChild(el("h3", "skin-collection-title", `Collection · ${owned}/${roots.length}`));

    const grid = el("div", "skin-grid");
    roots.forEach(root => grid.appendChild(buildSkinTile(deckId, root, selected)));
    section.appendChild(grid);

    section.appendChild(el("p", "skin-coming-soon", "🔒 D'autres paquets arriveront bientôt…"));

    const shopButton = el("button", "skin-shop-button", "🛒 Ouvrir la boutique");
    shopButton.type = "button";
    shopButton.addEventListener("click", openShop);
    section.appendChild(shopButton);

    body.appendChild(section);
    body.scrollTop = previousScroll;
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

    // Onglets : un bouton par jeu (DUO, DUO No Mercy, DUO Flip)
    const tabs = el("div", "");
    tabs.id = "skin-sidebar-tabs";
    tabs.setAttribute("role", "tablist");

    const body = el("div", "");
    body.id = "skin-sidebar-body";

    panel.append(header, tabs, body);
    sidebar.append(toggle, panel);
    document.body.appendChild(sidebar);

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") setSidebarOpen(false);
    });

    // Toucher en dehors de la liste déroulante des variantes la referme
    document.addEventListener("click", (event) => {
        if (openVariantMenuId === null) return;
        if (event.target.closest(".skin-dropdown")) return;

        openVariantMenuId = null;
        renderSkinSidebar();
    });

    renderSkinSidebar();
}