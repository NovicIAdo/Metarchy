import type { Strings } from '../types.js'

/**
 * Achievements (author's list, 2026-07-27). The catalog — ids, thresholds, which
 * key belongs to which badge — lives in packages/protocol/src/achievements.ts;
 * these are only the words.
 *
 * The counter families are composed rather than enumerated: six categories × three
 * tiers would be eighteen names and eighteen hints, so the name is "<category> ·
 * <tier>" and the hint is one sentence with {n} and {cat} substituted. `cat` is
 * the plain label, `catGen` the form that fits inside the hint sentence — Russian
 * needs the genitive there ("Сыграть 100 приватных игр 1 на 1"), and gluing a
 * nominative label into a sentence is how machine-shaped translations read wrong.
 */
export const achievements: Strings = {
  'achv.title': { en: 'Achievements', ru: 'Достижения' },
  'achv.earnedOf': { en: '{n} of {total}', ru: '{n} из {total}' },
  'achv.blurb': {
    en: 'Locked badges are goals — the requirement is written on every one of them.',
    ru: 'Закрытые значки — это цели: на каждом написано, что для него нужно.'
  },
  'achv.progress': { en: '{n} / {total}', ru: '{n} / {total}' },
  'achv.earnedOn': { en: 'Earned {date}', ru: 'Получено {date}' },
  'achv.none': { en: 'Nothing earned yet.', ru: 'Пока ничего не получено.' },

  'achv.group.learning': { en: 'Learning', ru: 'Обучение' },
  'achv.group.play': { en: 'Games played', ru: 'Сыгранные игры' },
  'achv.group.victory': { en: 'Victories', ru: 'Победы' },
  'achv.group.tactics': { en: 'Tactics', ru: 'Тактика' },

  // --- Counter families -------------------------------------------------------
  'achv.tier.10': { en: 'Regular', ru: 'Завсегдатай' },
  'achv.tier.100': { en: 'Veteran', ru: 'Ветеран' },
  'achv.tier.1000': { en: 'Legend', ru: 'Легенда' },

  'achv.play.hint': { en: 'Play {n} {cat} games', ru: 'Сыграть {n} {cat}' },

  'achv.cat.bots': { en: 'vs Bots', ru: 'Против ботов' },
  'achv.cat.private.1v1': { en: 'Private 1v1', ru: 'Приватные 1 на 1' },
  'achv.cat.private.ffa3': { en: 'Private 3-player', ru: 'Приватные на троих' },
  'achv.cat.private.2v2': { en: 'Private 2v2', ru: 'Приватные 2 на 2' },
  'achv.cat.ranked.1v1': { en: 'Ranked 1v1', ru: 'Рейтинговые 1 на 1' },
  'achv.cat.ranked.ffa3': { en: 'Ranked 3-player', ru: 'Рейтинговые на троих' },

  'achv.catGen.bots': { en: 'against bots', ru: 'игр против ботов' },
  'achv.catGen.private.1v1': { en: 'private 1v1', ru: 'приватных игр 1 на 1' },
  'achv.catGen.private.ffa3': { en: 'private 3-player', ru: 'приватных игр на троих' },
  'achv.catGen.private.2v2': { en: 'private 2v2', ru: 'приватных игр 2 на 2' },
  'achv.catGen.ranked.1v1': { en: 'ranked 1v1', ru: 'рейтинговых игр 1 на 1' },
  'achv.catGen.ranked.ffa3': { en: 'ranked 3-player', ru: 'рейтинговых игр на троих' },

  'achv.play.everyCategory': { en: 'Been everywhere', ru: 'Везде побывал' },
  'achv.play.everyCategory.hint': {
    en: 'Win at least one game in every category above',
    ru: 'Победить хотя бы раз в каждой категории выше'
  },

  // --- Tutorial ---------------------------------------------------------------
  'achv.feat.betaTester': { en: 'Beta tester', ru: 'Бета-тестер' },
  'achv.feat.betaTester.hint': {
    en: 'Played the closed beta',
    ru: 'Участвовал(а) в закрытой бетe'
  },
  'achv.feat.tutorial.complete': { en: 'Taught', ru: 'Обучен' },
  'achv.feat.tutorial.complete.hint': {
    en: 'Finish the tutorial instead of leaving it',
    ru: 'Пройти туториал до конца, а не выйти из него'
  },

  // --- Victories --------------------------------------------------------------
  'achv.feat.win.turn5': { en: 'On schedule', ru: 'В срок' },
  'achv.feat.win.turn5.hint': { en: 'Win on turn 5', ru: 'Победить за 5 ходов' },
  'achv.feat.win.turn6': { en: 'Overtime', ru: 'Овертайм' },
  'achv.feat.win.turn6.hint': { en: 'Win on turn 6', ru: 'Победить за 6 ходов' },
  'achv.feat.win.turn7': { en: 'Long game', ru: 'Долгая партия' },
  'achv.feat.win.turn7.hint': { en: 'Win on turn 7', ru: 'Победить за 7 ходов' },
  'achv.feat.win.turn8': { en: 'Marathon', ru: 'Марафон' },
  'achv.feat.win.turn8.hint': { en: 'Win on turn 8', ru: 'Победить за 8 ходов' },

  'achv.feat.win.first': { en: 'First blood', ru: 'Первая победа' },
  'achv.feat.win.first.hint': { en: 'Win your first game', ru: 'Победить в первой своей игре' },
  'achv.feat.win.tiebreak': { en: 'Wouldn’t end', ru: 'Никак не кончалась' },
  'achv.feat.win.tiebreak.hint': {
    en: 'Win a game that went to extra turns on a points tie',
    ru: 'Победить в игре, где из-за ничьей по очкам добавились ходы'
  },
  'achv.feat.win.landslide': { en: 'Landslide', ru: 'Разгром' },
  'achv.feat.win.landslide.hint': {
    en: 'Win with at least twice the points of everyone still standing',
    ru: 'Победить, набрав минимум вдвое больше очков, чем любой из оставшихся'
  },
  'achv.feat.win.noCards': { en: 'Arguments only', ru: 'Только аргументы' },
  'achv.feat.win.noCards.hint': {
    en: 'Win a game without playing a single Action Card',
    ru: 'Победить, не сыграв ни одной карты действия'
  },
  'achv.feat.win.vsHardBot': { en: 'Machine beaten', ru: 'Машина побеждена' },
  'achv.feat.win.vsHardBot.hint': {
    en: 'Beat the hard bot that fills ranked seats',
    ru: 'Победить сложного бота, который занимает места в рейтинговых играх'
  },

  // --- Tactics ----------------------------------------------------------------
  'achv.feat.turn.relocation3': { en: 'Everyone moves', ru: 'Всех переставил' },
  'achv.feat.turn.relocation3.hint': {
    en: 'Play 3 Relocations in one turn',
    ru: 'Сыграть 3 Релокации за ход'
  },
  'achv.feat.turn.exchange3': { en: 'Everything changes', ru: 'Всё поменял' },
  'achv.feat.turn.exchange3.hint': {
    en: 'Play 3 Change of Values in one turn',
    ru: 'Сыграть 3 Смены ценности за ход'
  },
  'achv.feat.turn.block3': { en: 'City shut down', ru: 'Город закрыт' },
  'achv.feat.turn.block3.hint': {
    en: 'Disable 3 Locations in one turn',
    ru: 'Отключить 3 локации за ход'
  },
  'achv.feat.turn.allKinds': { en: 'Full hand', ru: 'Полная рука' },
  'achv.feat.turn.allKinds.hint': {
    en: 'Play a Relocation, a Change of Values and a blocker in the same turn',
    ru: 'Сыграть за один ход Релокацию, Смену ценности и блокировку'
  }
}
