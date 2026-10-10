// "How to Play": a short illustrated walkthrough of the core loop, built from
// the live theme art so it always matches what the player sees on the board.
// Bilingual (follows the settings language), ends with a Play-vs-Bot CTA and a
// link to the full rulebook. Reachable from Home and the sign-in screen.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TopBar } from '../components/TopBar.js'
import { gameSocket } from '../net/socket.js'
import { useSessionStore } from '../stores/session.js'
import { LANGUAGES, useSettingsStore, type Language } from '../stores/settings.js'
import { themeAsset } from '../theme.js'

// This walkthrough carries its copy inline (it is one screen of prose, not
// scattered labels). English and Russian are authored here; a language without
// its own line falls back to English rather than blanking the page.
type L = { en: string; ru: string } & Partial<Record<Language, string>>
const pick = (l: L, lang: Language): string => l[lang] ?? l.en
interface Art {
  key: string
  label: L
}
interface Step {
  title: L
  art: Art[]
  body: L[]
}

const none: L = { en: '', ru: '', si: '' }

const STEPS: Step[] = [
  {
    title: { en: 'The Goal', ru: 'Цель', si: 'අරමුණ' },
    art: [
      { key: 'value.power', label: { en: 'Power', ru: 'Власть', si: 'බලය' } },
      { key: 'value.art', label: { en: 'Art', ru: 'Искусство', si: 'කලාව' } },
      { key: 'value.knowledge', label: { en: 'Knowledge', ru: 'Знание', si: 'දැනුම' } },
      { key: 'value.vp', label: { en: 'Victory Point', ru: 'Победный балл', si: 'ජයග්‍රාහී ලකුණ' } }
    ],
    body: [
      {
        en: 'Metarchy is a game of bluffing and reading your opponents over 5 turns.',
        ru: 'Metarchy — игра о блефе и чтении соперников за 5 ходов.',
        si: 'Metarchy කියන්නේ වාර 5ක් පුරා එකිනෙකා රවටමින්, ප්‍රතිවාදීන් හිතන දේ කියවමින් සෙල්ලම් කරන ක්‍රීඩාවක්.'
      },
      {
        en: 'You score a Victory Point for every full set of one Power + one Art + one Knowledge.',
        ru: 'Победный балл — за полный набор: 1 Власть + 1 Искусство + 1 Знание.',
        si: 'බලය එකක් + කලාව එකක් + දැනුම එකක් යන සම්පූර්ණ කට්ටලයක් හදාගන්නා හැම වතාවකම ඔබට ජයග්‍රාහී ලකුණක් ලැබෙනවා.'
      },
      {
        en: 'Most Victory Points after Turn 5 wins.',
        ru: 'Больше всех баллов после Хода 5 — победа.',
        si: 'වාර 5 අවසානයේ වැඩිම ජයග්‍රාහී ලකුණු තියෙන අයට ජය.'
      }
    ]
  },
  {
    title: { en: 'Your Actors', ru: 'Ваши Деятели', si: 'ඔබේ ක්‍රියාකාරීන්' },
    art: [
      {
        key: 'actor.politician.head',
        label: { en: 'Politician', ru: 'Политик', si: 'දේශපාලනඥයා' }
      },
      { key: 'actor.scientist.head', label: { en: 'Scientist', ru: 'Учёный', si: 'විද්‍යාඥයා' } },
      { key: 'actor.artist.head', label: { en: 'Artist', ru: 'Артист', si: 'කලාකරුවා' } },
      { key: 'actor.robot.head', label: { en: 'Robot', ru: 'Робот', si: 'රොබෝව' } }
    ],
    body: [
      {
        en: 'You command four Actors. Humans — Politician, Scientist, Artist — create Values (Power, Art, Knowledge).',
        ru: 'У вас четыре Деятеля. Люди — Политик, Учёный, Артист — создают Ценности (Власть, Искусство, Знание).',
        si: 'ඔබට ක්‍රියාකාරීන් හතරදෙනෙක් ඉන්නවා. මිනිස් ක්‍රියාකාරීන් — දේශපාලනඥයා, විද්‍යාඥයා, කලාකරුවා — වටිනාකම් (බලය, කලාව, දැනුම) නිර්මාණය කරනවා.'
      },
      {
        en: 'The Robot instead produces Resources (Product, Electricity, Recycling) that fuel your bets.',
        ru: 'Робот вместо этого производит Ресурсы (Продукт, Электричество, Переработка) для ставок.',
        si: 'රොබෝව නම් ඒ වෙනුවට සම්පත් (නිෂ්පාදන, විදුලිය, ප්‍රතිචක්‍රීකරණ) හදනවා — ඔබේ ඔට්ටු තියන්න ඕන වෙන්නේ ඒවා.'
      },
      {
        en: 'Each Actor may only go to certain Locations — a Politician to the Square or University, a Robot to the Factory, Power Plant or Dump.',
        ru: 'Каждый Деятель ходит только на свои Локации: Политик — Площадь или Университет, Робот — Фабрика, Электростанция или Свалка.',
        si: 'හැම ක්‍රියාකාරියෙකුටම යන්න පුළුවන් ඇතැම් ස්ථාන වලට විතරයි — දේශපාලනඥයාට චතුරශ්‍රයට හෝ විශ්වවිද්‍යාලයට, රොබෝවට කර්මාන්ත ශාලාවට, බලාගාරයට හෝ කසළ බිමට.'
      }
    ]
  },
  {
    title: { en: 'Place & Argue', ru: 'Расставь и поспорь', si: 'තැබීම සහ තර්ක කිරීම' },
    art: [
      { key: 'argument.rock', label: { en: 'Rock', ru: 'Камень', si: 'ගල' } },
      { key: 'argument.paper', label: { en: 'Paper', ru: 'Бумага', si: 'කඩදාසි' } },
      { key: 'argument.scissors', label: { en: 'Scissors', ru: 'Ножницы', si: 'කතුර' } },
      { key: 'argument.dummy', label: { en: 'Dummy', ru: 'Пустышка', si: 'හිස් කාසිය' } }
    ],
    body: [
      {
        en: 'Each turn you secretly send Actors to Locations. Every Actor carries one hidden Argument — Rock, Paper, Scissors or Dummy — and no two of your Actors may share one.',
        ru: 'Каждый ход вы тайно отправляете Деятелей на Локации. У каждого один скрытый Аргумент — Камень, Бумага, Ножницы или Пустышка — и одинаковых у ваших Деятелей быть не может.',
        si: 'හැම වාරයකදීම ඔබ රහසින් ක්‍රියාකාරීන්ව ස්ථාන වලට යවනවා. හැම ක්‍රියාකාරියෙක්ම සැඟවුණු තර්කයක් — ගල, කඩදාසි, කතුර හෝ හිස් කාසිය — අරගෙන යනවා. ඔබේ ක්‍රියාකාරීන් දෙදෙනෙකුට එකම තර්කය දෙන්න බෑ.'
      },
      {
        en: 'You may also spend a Resource to place a Bet on how a clash will end (Win, Lose or Draw).',
        ru: 'Можно также потратить Ресурс на Ставку об исходе столкновения (Победа, Поражение или Ничья).',
        si: 'ගැටුමක් අවසන් වෙන්නේ කොහොමද කියලා (ජය, පරාජය හෝ සමතාව) සම්පතක් වියදම් කරලා ඔට්ටුවක් තියන්නත් පුළුවන්.'
      },
      {
        en: 'Nothing is revealed until everyone has committed.',
        ru: 'Ничего не вскрывается, пока все не зафиксируют выбор.',
        si: 'හැමෝම තමන්ගේ තීරණය තහවුරු කරන තුරු කිසිවක් හෙළි වෙන්නේ නෑ.'
      }
    ]
  },
  {
    title: { en: 'Conflicts', ru: 'Конфликты', si: 'ගැටුම්' },
    art: [
      { key: 'argument.rock', label: none },
      { key: 'location.square.closeup', label: { en: 'Conflict', ru: 'Конфликт', si: 'ගැටුම' } },
      { key: 'argument.scissors', label: none }
    ],
    body: [
      {
        en: 'When two Actors of the same type meet in one Location, they clash. Hidden Arguments flip over and Rock-Paper-Scissors decides who wins the right to create the Value.',
        ru: 'Когда два Деятеля одного типа встречаются на одной Локации, они сталкиваются. Скрытые Аргументы вскрываются, и Камень-Ножницы-Бумага решает, кто получает право создать Ценность.',
        si: 'එකම වර්ගයේ ක්‍රියාකාරීන් දෙදෙනෙක් එකම ස්ථානයකට ආවොත් ගැටුමක් හැදෙනවා. සැඟවුණු තර්ක දෙක හැරෙනවා, වටිනාකම නිර්මාණය කරන අයිතිය කාට ලැබෙනවාද කියලා ගල-කඩදාසි-කතුරෙන් තීරණය වෙනවා.'
      },
      {
        en: 'A correct Bet pays off; a wrong one burns the Resource either way.',
        ru: 'Верная Ставка приносит награду; неверная сжигает Ресурс в любом случае.',
        si: 'හරි ඔට්ටුවකින් ලාභයක් එනවා; වැරදුණොත් සම්පත කොහොම වුණත් නැති වෙනවා.'
      },
      {
        en: 'Ties are broken by another round — so a good Argument and a cool nerve both matter.',
        ru: 'Ничьи переигрываются — важны и хороший Аргумент, и крепкие нервы.',
        si: 'සමතාවක් ආවොත් තව වටයකින් තීරණය වෙනවා — ඒ නිසා හොඳ තර්කයක් වගේම සන්සුන් හිතකුත් වැදගත්.'
      }
    ]
  },
  {
    title: { en: 'Trade & Cards', ru: 'Обмен и карты', si: 'හුවමාරුව සහ කාඩ්පත්' },
    art: [
      { key: 'resource.product', label: { en: 'Product', ru: 'Продукт', si: 'නිෂ්පාදන' } },
      {
        key: 'resource.electricity',
        label: { en: 'Electricity', ru: 'Электричество', si: 'විදුලිය' }
      },
      {
        key: 'resource.recycling',
        label: { en: 'Recycling', ru: 'Переработка', si: 'ප්‍රතිචක්‍රීකරණ' }
      },
      {
        key: 'deck.action',
        label: { en: 'Action Cards', ru: 'Карты действий', si: 'ක්‍රියා කාඩ්පත්' }
      }
    ],
    body: [
      {
        en: 'At the end of a turn you trade Resources and buy Action Cards.',
        ru: 'В конце хода вы обмениваете Ресурсы и покупаете Карты действий.',
        si: 'වාරයක් අවසානයේ ඔබට සම්පත් හුවමාරු කරගෙන ක්‍රියා කාඩ්පත් මිලදී ගන්න පුළුවන්.'
      },
      {
        en: 'Action Cards bend the rules — relocate an Actor, disable a Location, swap Values, and more.',
        ru: 'Карты действий гнут правила — переместить Деятеля, отключить Локацию, обменять Ценности и не только.',
        si: 'ක්‍රියා කාඩ්පත් නීති ටිකක් නවනවා — ක්‍රියාකාරියෙක්ව වෙන ස්ථානයකට ගෙනියන්න, ස්ථානයක් වසා දමන්න, වටිනාකම් හුවමාරු කරන්න, තව බොහෝ දේ.'
      },
      {
        en: 'Event Cards, drawn at the start of a turn, shake up the board for everyone.',
        ru: 'Карты событий в начале хода встряхивают поле для всех.',
        si: 'වාරයක් පටන් ගන්නා විට අදින සිදුවීම් කාඩ්පත් හැමෝටම පුවරුවේ තත්ත්වය වෙනස් කරනවා.'
      }
    ]
  },
  {
    title: { en: 'Win the Game', ru: 'Победа', si: 'ක්‍රීඩාව දිනන්න' },
    art: [
      { key: 'value.vp', label: none },
      { key: 'value.fame', label: { en: 'Fame', ru: 'Слава', si: 'කීර්තිය' } }
    ],
    body: [
      {
        en: 'After Turn 5, whoever holds the most Victory Points wins. A tie adds an extra decider turn.',
        ru: 'После Хода 5 побеждает тот, у кого больше всех Победных баллов. Ничья добавляет решающий ход.',
        si: 'වාර 5 අවසානයේ වැඩිම ජයග්‍රාහී ලකුණු තියෙන ක්‍රීඩකයා දිනනවා. සමතාවක් ආවොත් තීරණාත්මක අමතර වාරයක් එකතු වෙනවා.'
      },
      {
        en: 'Fame is a wild Value that fills your weakest stat — handy for completing that last set.',
        ru: 'Слава — дикая Ценность, заполняет самый слабый показатель — удобно добить последний набор.',
        si: 'කීර්තිය කියන්නේ ඕනෑම තැනකට ගැළපෙන වටිනාකමක් — ඔබේ අඩුම වටිනාකම එයින් පිරෙනවා. අන්තිම කට්ටලය සම්පූර්ණ කරගන්න නියම දෙයක්.'
      },
      {
        en: 'The fastest way to learn is to play. Start a game against a bot below.',
        ru: 'Быстрее всего учиться — играя. Начни партию с ботом ниже.',
        si: 'ඉගෙන ගන්න ඉක්මන්ම ක්‍රමය සෙල්ලම් කිරීමයි. පහතින් බොට් එකක් එක්ක ක්‍රීඩාවක් පටන් ගන්න.'
      }
    ]
  }
]

const CHROME = {
  en: {
    howToPlay: 'How to Play',
    back: '← Back',
    next: 'Next →',
    playBot: 'Start the Tutorial',
    readRules: 'Read the full rules',
    home: 'Home'
  },
  ru: {
    howToPlay: 'Обучение',
    back: '← Назад',
    next: 'Дальше →',
    playBot: 'Начать обучение',
    readRules: 'Читать все правила',
    home: 'Домой'
  },
  si: {
    howToPlay: 'සෙල්ලම් කරන ආකාරය',
    back: '← ආපසු',
    next: 'ඊළඟ →',
    playBot: 'උපදෙස් පාඩම අරඹන්න',
    readRules: 'සම්පූර්ණ නීති කියවන්න',
    home: 'මුල් පිටුව'
  }
} satisfies Partial<Record<Language, Record<string, string>>>

export function TutorialScreen() {
  const navigate = useNavigate()
  const online = useSessionStore((s) => s.socketStatus === 'online')
  const language = useSettingsStore((s) => s.language)
  const setLanguage = useSettingsStore((s) => s.setLanguage)
  const c = CHROME[language] ?? CHROME.en
  const [i, setI] = useState(0)
  const [busy, setBusy] = useState(false)
  const step = STEPS[i]!
  const last = i === STEPS.length - 1

  async function playBot() {
    if (busy || !online) return
    setBusy(true)
    try {
      // Launch the coached, no-timer Tutorial (not a plain bot game).
      const created = await gameSocket.createGame({ mode: 'tutorial' })
      navigate(`/game/${created.p.gameId}`)
    } catch {
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <TopBar />
      <img className="logo" src={themeAsset('logo')} alt="Metarchy" />
      <div className="panel tutorial-panel">
        <div className="doc-actions">
          <h2 style={{ margin: 0 }}>
            {c.howToPlay} <span className="tutorial-step">{`${i + 1} / ${STEPS.length}`}</span>
          </h2>
          <div className="lang-toggle">
            {LANGUAGES.map((l) => (
              <button
                key={l.id}
                className={`lang-btn ${language === l.id ? 'active' : ''}`}
                onClick={() => setLanguage(l.id)}
              >
                {l.short}
              </button>
            ))}
          </div>
        </div>

        <div className="tutorial-art">
          {step.art.map((a, idx) => (
            <figure key={`${a.key}-${idx}`}>
              <img src={themeAsset(a.key)} alt={pick(a.label, language)} draggable={false} />
              {pick(a.label, language) && <figcaption>{pick(a.label, language)}</figcaption>}
            </figure>
          ))}
        </div>

        <h3 className="tutorial-title">{pick(step.title, language)}</h3>
        {step.body.map((p, idx) => (
          <p key={idx} className="tutorial-body">
            {pick(p, language)}
          </p>
        ))}

        <div className="tutorial-dots">
          {STEPS.map((_, idx) => (
            <button
              key={idx}
              className={`tutorial-dot ${idx === i ? 'active' : ''}`}
              aria-label={`${i + 1}`}
              onClick={() => setI(idx)}
            />
          ))}
        </div>

        <div className="tutorial-nav">
          <button className="btn secondary" disabled={i === 0} onClick={() => setI(i - 1)}>
            {c.back}
          </button>
          {last ? (
            <button className="btn" disabled={busy || !online} onClick={() => void playBot()}>
              {c.playBot}
            </button>
          ) : (
            <button className="btn" onClick={() => setI(i + 1)}>
              {c.next}
            </button>
          )}
        </div>

        <div className="doc-actions">
          <button className="btn secondary" onClick={() => navigate('/rules')}>
            {c.readRules}
          </button>
          <button className="btn secondary" onClick={() => navigate('/')}>
            {c.home}
          </button>
        </div>
      </div>
    </div>
  )
}
