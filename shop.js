// shop.js - Boutique (points DUO) et rattrapage des skins de niveau
// Logique pure : pas de Firebase, pas de DOM.
//
// Pour VENDRE un skin, déclare-le dans SKINS (skins.js) avec :
//     unlock: "shop", price: 100
// Pour une VARIANTE d'un skin existant, ajoute en plus :
//     parent: "id-du-skin-de-base", variantName: "Négatif"
// (on ne peut acheter une variante que si on possède déjà le skin de base)

import { SKINS } from "./skins.js";
import { getLevelFromExp, createEmptyProgress } from "./levels.js";

// ---------------------------------------------------------------------------
// CATALOGUE
// ---------------------------------------------------------------------------

export function getSkinById(skinId) {
    return SKINS.find(skin => skin.id === skinId) || null;
}

// Tous les skins vendus en boutique
export function getShopSkins() {
    return SKINS.filter(skin => skin.unlock === "shop");
}

// Le joueur possède-t-il ce skin ?
export function isSkinOwned(progress, skin) {
    return skin.unlock === "default" || !!progress?.unlockedSkins?.[skin.id];
}

// ---------------------------------------------------------------------------
// ACHATS
// ---------------------------------------------------------------------------

// Situation d'un article pour ce joueur :
//   owned           : déjà possédé
//   not-for-sale    : pas vendu en boutique (ou sans prix valide)
//   missing-parent  : variante dont le skin de base n'est pas encore possédé
//   too-expensive   : pas assez de points (missing = points manquants)
//   available       : achetable
export function getPurchaseStatus(progress, skin) {
    if (isSkinOwned(progress, skin)) return { status: "owned" };

    if (skin.unlock !== "shop" || !(skin.price > 0)) return { status: "not-for-sale" };

    const parent = skin.parent ? getSkinById(skin.parent) : null;
    if (parent && !isSkinOwned(progress, parent)) {
        return { status: "missing-parent", parent: parent };
    }

    const points = progress?.duoPoints || 0;
    if (points < skin.price) {
        return { status: "too-expensive", missing: skin.price - points };
    }

    return { status: "available" };
}

// Applique un achat à la progression d'un joueur.
// Fonction pure : retourne { ok, progress, summary } ou { ok: false, error }.
export function applyPurchase(currentProgress, skinId) {
    const skin = getSkinById(skinId);
    if (!skin) return { ok: false, error: "unknown" };

    const progress = {
        ...createEmptyProgress(),
        ...currentProgress,
        unlockedSkins: { ...(currentProgress?.unlockedSkins || {}) }
    };

    const check = getPurchaseStatus(progress, skin);
    if (check.status !== "available") {
        return { ok: false, error: check.status, check: check };
    }

    progress.duoPoints = (progress.duoPoints || 0) - skin.price;
    progress.duoPointsSpent = (progress.duoPointsSpent || 0) + skin.price;
    progress.unlockedSkins[skin.id] = true;

    return {
        ok: true,
        progress: progress,
        summary: {
            skinId: skin.id,
            name: skin.name,
            price: skin.price,
            pointsLeft: progress.duoPoints
        }
    };
}

// ---------------------------------------------------------------------------
// RATTRAPAGE DES SKINS DE NIVEAU
// ---------------------------------------------------------------------------
// Un skin de niveau est normalement débloqué au moment où l'on franchit son niveau.
// Si on modifie un niveau (ou qu'on ajoute un skin) après coup, les joueurs qui ont déjà
// dépassé ce niveau ne l'auraient jamais : on vérifie donc à chaque connexion.

export function getMissingLevelRewards(progress) {
    const level = getLevelFromExp(progress?.exp || 0);

    return SKINS.filter(skin =>
        skin.unlock === "level" &&
        skin.unlockLevel <= level &&
        !progress?.unlockedSkins?.[skin.id]
    );
}

// Retourne { progress, newSkins } avec tous les skins manquants débloqués
export function applyLevelRewardsCatchUp(currentProgress) {
    const progress = {
        ...createEmptyProgress(),
        ...currentProgress,
        unlockedSkins: { ...(currentProgress?.unlockedSkins || {}) }
    };

    const missing = getMissingLevelRewards(progress);
    missing.forEach(skin => { progress.unlockedSkins[skin.id] = true; });

    return {
        progress: progress,
        newSkins: missing.map(skin => ({ id: skin.id, name: skin.name }))
    };
}