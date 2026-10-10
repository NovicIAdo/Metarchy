import type { Strings } from '../types.js'

// Game vocabulary. RU terms are the canon from docs/metarchy-rules.ru.md
// (Actor = Деятель, Artist = Артист, etc.) so in-game labels match the rulebook.
// These keys back the language-aware helpers in ../domain.ts, which replace the
// English-only maps that used to live in screens/game/labels.ts.
export const domain: Strings = {
  // Generic nouns
  'word.actor': { en: 'Actor', ru: 'Деятель' },
  'word.player': { en: 'Player', ru: 'Игрок' },
  'word.argument': { en: 'Argument', ru: 'Аргумент' },
  'word.bet': { en: 'Bet', ru: 'Ставка' },
  'word.value': { en: 'Value', ru: 'Ценность' },
  'word.resource': { en: 'Resource', ru: 'Ресурс' },
  'word.location': { en: 'Location', ru: 'Локация' },
  'word.conflict': { en: 'Conflict', ru: 'Конфликт' },
  'word.turn': { en: 'Turn', ru: 'Ход' },
  'word.eventCard': { en: 'Event Card', ru: 'Карта события' },
  'word.actionCard': { en: 'Action Card', ru: 'Карта действий' },

  // Actors
  'actor.politician': { en: 'Politician', ru: 'Политик' },
  'actor.scientist': { en: 'Scientist', ru: 'Учёный' },
  'actor.artist': { en: 'Artist', ru: 'Артист' },
  'actor.robot': { en: 'Robot', ru: 'Робот' },

  // Arguments
  'arg.rock': { en: 'Rock', ru: 'Камень' },
  'arg.paper': { en: 'Paper', ru: 'Бумага' },
  'arg.scissors': { en: 'Scissors', ru: 'Ножницы' },
  'arg.dummy': { en: 'Dummy', ru: 'Пустышка' },

  // Bets / outcomes
  'bet.win': { en: 'Win', ru: 'Победа' },
  'bet.lose': { en: 'Lose', ru: 'Поражение' },
  'bet.draw': { en: 'Draw', ru: 'Ничья' },

  // Resources
  'resource.product': { en: 'Product', ru: 'Продукт' },
  'resource.electricity': { en: 'Electricity', ru: 'Электричество' },
  'resource.recycling': { en: 'Recycling', ru: 'Переработка' },

  // Values
  'value.power': { en: 'Power', ru: 'Власть' },
  'value.art': { en: 'Art', ru: 'Искусство' },
  'value.knowledge': { en: 'Knowledge', ru: 'Знание' },
  'value.fame': { en: 'Fame', ru: 'Слава' },

  // Locations (English matches board/layout.ts LOCATION_LABELS)
  'location.square': { en: 'The Square', ru: 'Площадь' },
  'location.theatre': { en: 'The Theatre', ru: 'Театр' },
  'location.university': { en: 'University', ru: 'Университет' },
  'location.factory': { en: 'Factory', ru: 'Фабрика' },
  'location.power_plant': { en: 'Power Plant', ru: 'Электростанция' },
  'location.dump': { en: 'The Dump', ru: 'Свалка' },

  // Phases
  'phase.p1_event': { en: 'Phase 1 · Event', ru: 'Фаза 1 · Событие' },
  'phase.p2_distribution': { en: 'Phase 2 · Distribution', ru: 'Фаза 2 · Распределение' },
  'phase.p3_action': { en: 'Phase 3 · Actions', ru: 'Фаза 3 · Действия' },
  'phase.p4_conflict': { en: 'Phase 4 · Conflicts', ru: 'Фаза 4 · Конфликты' },
  'phase.p5_market': { en: 'Phase 5 · Market', ru: 'Фаза 5 · Рынок' },
  'phase.finished': { en: 'Finished', ru: 'Завершено' },

  // Event cards — names
  'card.event.political_repression': { en: 'Political Repression', ru: 'Политические репрессии' },
  'card.event.educational_crisis': { en: 'Educational Crisis', ru: 'Кризис образования' },
  'card.event.cultural_decline': { en: 'Cultural Decline', ru: 'Культурный упадок' },
  'card.event.revolution': { en: 'Revolution', ru: 'Революция' },
  'card.event.help_poor_countries': { en: 'Help Poor Countries', ru: 'Помощь бедным странам' },
  'card.event.earth_hour': { en: 'Earth Hour', ru: 'Час Земли' },
  'card.event.prevent_eco_crisis': { en: 'Prevent Eco-Crisis', ru: 'Предотвратить эко-кризис' },

  // Event cards — rule summaries
  'card.event.political_repression.rule': {
    en: 'Compare Power. Least Power wins Fame.',
    ru: 'Сравните Власть. У кого меньше всех — получает Славу.'
  },
  'card.event.educational_crisis.rule': {
    en: 'Compare Knowledge. Least Knowledge wins Fame.',
    ru: 'Сравните Знание. У кого меньше всех — получает Славу.'
  },
  'card.event.cultural_decline.rule': {
    en: 'Compare Art. Least Art wins Fame.',
    ru: 'Сравните Искусство. У кого меньше всех — получает Славу.'
  },
  'card.event.revolution.rule': {
    en: 'Compare total Values. Lowest total wins Fame.',
    ru: 'Сравните сумму Ценностей. У кого наименьшая — получает Славу.'
  },
  'card.event.help_poor_countries.rule': {
    en: 'Secretly discard Product. Most discarded wins an Action Card.',
    ru: 'Тайно сбросьте Продукт. Кто сбросил больше — берёт Карту действий.'
  },
  'card.event.earth_hour.rule': {
    en: 'Secretly discard Electricity. Most discarded wins an Action Card.',
    ru: 'Тайно сбросьте Электричество. Кто сбросил больше — берёт Карту действий.'
  },
  'card.event.prevent_eco_crisis.rule': {
    en: 'Secretly discard Recycling. Most discarded wins an Action Card.',
    ru: 'Тайно сбросьте Переработку. Кто сбросил больше — берёт Карту действий.'
  },

  // Action cards — names
  'card.action.construction_work': { en: 'Under Construction', ru: 'Строительные работы' },
  'card.action.charity_event': { en: 'Charity Event', ru: 'Благотворительное событие' },
  'card.action.student_protests': { en: 'Student Protests', ru: 'Студенческие протесты' },
  'card.action.sabotage': { en: 'Sabotage', ru: 'Саботаж' },
  'card.action.cable_stolen': { en: 'Blackout', ru: 'Украли кабель' },
  'card.action.environmental_protests': { en: 'Ecological Protests', ru: 'Протесты экологов' },
  'card.action.relocation': { en: 'Relocation', ru: 'Релокация' },
  'card.action.change_values': { en: 'Change of Values', ru: 'Смена Ценностей' },

  // Action cards — rule summaries
  'card.action.construction_work.rule': {
    en: 'Shuts down The Square this turn — every Actor there returns with nothing.',
    ru: 'Закрывает Площадь на этот Ход — все Деятели там возвращаются ни с чем.'
  },
  'card.action.charity_event.rule': {
    en: 'Shuts down The Theatre this turn — every Actor there returns with nothing.',
    ru: 'Закрывает Театр на этот Ход — все Деятели там возвращаются ни с чем.'
  },
  'card.action.student_protests.rule': {
    en: 'Shuts down University this turn — every Actor there returns with nothing.',
    ru: 'Закрывает Университет на этот Ход — все Деятели там возвращаются ни с чем.'
  },
  'card.action.sabotage.rule': {
    en: 'Shuts down Factory this turn — every Actor there returns with nothing.',
    ru: 'Закрывает Фабрику на этот Ход — все Деятели там возвращаются ни с чем.'
  },
  'card.action.cable_stolen.rule': {
    en: 'Shuts down Power Plant this turn — every Actor there returns with nothing.',
    ru: 'Закрывает Электростанцию на этот Ход — все Деятели там возвращаются ни с чем.'
  },
  'card.action.environmental_protests.rule': {
    en: 'Shuts down The Dump this turn — every Actor there returns with nothing.',
    ru: 'Закрывает Свалку на этот Ход — все Деятели там возвращаются ни с чем.'
  },
  'card.action.relocation.rule': {
    en: 'Move any Actor on the board — yours or a rival’s — to a location it may enter.',
    ru: 'Переместите любого Деятеля на столе — своего или чужого — на допустимую для него Локацию.'
  },
  'card.action.change_values.rule': {
    en: 'Give one of your Values and take one from any rival’s pool.',
    ru: 'Отдайте одну свою Ценность и возьмите одну из пула любого соперника.'
  }
}
