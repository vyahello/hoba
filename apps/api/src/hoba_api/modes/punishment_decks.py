"""Bundled punishment decks (spec §5.3). Server-authoritative — never sent
to the client; only the dealt card text crosses the wire.

Tone ladder:
- mild  — silly, all-ages party dares.
- spicy — bolder adult-party dares (flirty/embarrassing, tasteful;
          no explicit NSFW, nothing unsafe or non-consensual).
- chaos — absurd wildcard dares.

Cards are written natively per language (spec §6), NOT translated, so the
en/uk lists do not need to align by index. Owner curates/tunes tone; the
integrity test (exactly 30 unique non-empty per deck×lang) is the gate.
"""

from __future__ import annotations

import structlog

log = structlog.get_logger("hoba_api.modes.punishment_decks")

DECK_IDS = ("mild", "spicy", "chaos")
DECK_LANGS = ("en", "uk")
CARDS_PER_DECK = 30

DECKS: dict[str, dict[str, list[str]]] = {
    "mild": {
        "en": [
            "Speak in a robot voice until your next turn.",
            "Do your best impression of someone in the room.",
            "Sing the chorus of any song right now.",
            "Talk only in rhymes until your next turn.",
            "Do 10 jumping jacks.",
            "Tell an embarrassing childhood story.",
            "Let the player on your right tickle-test your laugh.",
            "Do your best catwalk across the room.",
            "Speak in an accent until your next turn.",
            "Show the last photo in your camera roll.",
            "Do your best impression of a baby crying.",
            "Compliment everyone in the room, one by one.",
            "Hold a plank until your next turn.",
            "Do your best evil-villain laugh.",
            "Talk in slow motion for the next two minutes.",
            "Balance a spoon on your nose for 10 seconds.",
            "Do your best impression of your favourite animal.",
            "Make up a 10-second jingle about this room.",
            "Wear your shirt backwards until your next turn.",
            "Do your best dramatic movie death.",
            "Say the alphabet backwards from M.",
            "Give a 20-second speech about your socks.",
            "Do your best slow-motion victory celebration.",
            "Pretend to be a tour guide describing this room.",
            "Do 5 push-ups (or 5 of your best squats).",
            "Talk without using the letter 'e' for one minute.",
            "Do your best impression of a news anchor.",
            "Hum a song and let others guess it.",
            "Strike a superhero pose and hold it for 15 seconds.",
            "Let someone draw a tiny doodle on your hand.",
        ],
        "uk": [
            "Говори голосом робота до свого наступного ходу.",
            "Зобрази когось із присутніх у кімнаті.",
            "Заспівай приспів будь-якої пісні просто зараз.",
            "Говори лише римами до наступного ходу.",
            "Зроби 10 стрибків «джампінг-джек».",
            "Розкажи незручну історію з дитинства.",
            "Дозволь сусіду праворуч перевірити твій сміх.",
            "Пройдись по кімнаті як модель на подіумі.",
            "Говори з акцентом до свого наступного ходу.",
            "Покажи останнє фото у своїй галереї.",
            "Зобрази, як плаче немовля.",
            "Зроби комплімент кожному в кімнаті по черзі.",
            "Тримай планку до свого наступного ходу.",
            "Засмійся найзлішим лиходійським сміхом.",
            "Говори в режимі сповільнення наступні дві хвилини.",
            "Втримай ложку на носі 10 секунд.",
            "Зобрази свою улюблену тварину.",
            "Придумай 10-секундний джингл про цю кімнату.",
            "Вдягни футболку задом наперед до наступного ходу.",
            "Зобрази драматичну смерть як у кіно.",
            "Назви абетку у зворотному порядку від «М».",
            "Виголоси 20-секундну промову про свої шкарпетки.",
            "Святкуй перемогу в режимі сповільненої зйомки.",
            "Будь екскурсоводом і опиши цю кімнату.",
            "Зроби 5 віджимань (або 5 присідань).",
            "Говори хвилину без літери «е».",
            "Зобрази ведучого новин.",
            "Наспівуй пісню, нехай інші вгадують.",
            "Прийми позу супергероя й тримай 15 секунд.",
            "Дозволь комусь намалювати маленький малюнок на твоїй руці.",
        ],
    },
    "spicy": {
        "en": [
            "Let the group pick your profile photo for the next hour.",
            "Text the 3rd person in your chats: 'I was just thinking about you'.",
            "Reveal the last thing you searched on your phone.",
            "Show the most recent meme you saved.",
            "Let the room read your most-used emoji out loud.",
            "Share a screenshot of your home screen.",
            "Tell the room your celebrity crush.",
            "Reveal one thing on your bucket list nobody knows.",
            "Let the player on your left send one emoji to anyone in your chats.",
            "Confess the pettiest thing you've done this month.",
            "Do your best flirty wink at the person across from you.",
            "Tell the room the nickname you'd never want repeated.",
            "Show the oldest photo on your phone.",
            "Reveal how many alarms you have set right now.",
            "Tell the room your most-played song this year.",
            "Let the group ask you one yes/no question you must answer truthfully.",
            "Share the last voice message you received.",
            "Tell the room a tiny secret talent you have.",
            "Reveal your screen time for today.",
            "Describe your ideal first date in 15 seconds.",
            "Tell the room the last thing that made you blush.",
            "Let someone scroll your camera roll back 10 photos.",
            "Reveal a guilty-pleasure show you secretly love.",
            "Tell the room your worst dating-app story.",
            "Show the last gif you sent in any chat.",
            "Admit which person here you'd call in an emergency, and why.",
            "Reveal the contact name you saved for your best friend.",
            "Tell the room a compliment you secretly want to hear.",
            "Let the group choose a one-word status you must post.",
            "Reveal the last thing you whispered to someone.",
        ],
        "uk": [
            "Дозволь групі обрати тобі фото профілю на наступну годину.",
            "Напиши третьому контакту в чатах: «Я щойно про тебе думав(-ла)».",
            "Покажи, що ти востаннє шукав(-ла) у телефоні.",
            "Покажи останній збережений мем.",
            "Нехай кімната вголос назве твій найчастіший емодзі.",
            "Поділись скриншотом свого головного екрана.",
            "Назви свою знаменитість-краш.",
            "Розкрий одну мрію зі списку бажань, про яку ніхто не знає.",
            "Дозволь сусіду ліворуч надіслати один емодзі будь-кому з твоїх чатів.",
            "Зізнайся в найдріб'язковішому вчинку цього місяця.",
            "Кокетливо підморгни людині навпроти.",
            "Назви прізвисько, яке не хотів(-ла) би почути ще раз.",
            "Покажи найстаріше фото у своєму телефоні.",
            "Скажи, скільки будильників у тебе зараз встановлено.",
            "Назви свою найпрослуханішу пісню цього року.",
            "Дозволь групі поставити одне запитання «так/ні», на яке відповіси чесно.",
            "Поділись останнім голосовим, яке отримав(-ла).",
            "Розкажи про свій маленький прихований талант.",
            "Покажи свій екранний час за сьогодні.",
            "Опиши ідеальне перше побачення за 15 секунд.",
            "Назви останнє, від чого ти зашарівся(-лася).",
            "Дозволь комусь прогорнути твою галерею на 10 фото назад.",
            "Назви серіал — приховану насолоду, який таємно любиш.",
            "Розкажи найгіршу історію зі застосунку для знайомств.",
            "Покажи останній gif, який надсилав(-ла) у будь-якому чаті.",
            "Зізнайся, кому з присутніх подзвонив(-ла) би в надзвичайній ситуації, і чому.",
            "Назви, як збережений контакт найкращого друга.",
            "Назви комплімент, який таємно хочеш почути.",
            "Нехай група обере одне слово-статус, який ти маєш опублікувати.",
            "Назви останнє, що ти комусь прошепотів(-ла).",
        ],
    },
    "chaos": {
        "en": [
            "Swap one item of clothing with the player on your left.",
            "Everyone changes seats; you sit last.",
            "Talk only in questions until your next turn.",
            "Let the room give you a new name for the rest of the game.",
            "Swap phones (locked) with someone until your next turn.",
            "Do everything with your eyes closed until your next turn.",
            "Add a dramatic sound effect after everyone speaks for 2 minutes.",
            "Let the group choose an emoji you must say out loud every turn.",
            "Narrate everything you do out loud until your next turn.",
            "Trade seats with whoever spun before you.",
            "Speak only in a whisper until two more spins happen.",
            "Let the room invent a 3-second dance you do each turn.",
            "Hold hands with the person beside you for the next round.",
            "End every sentence with 'allegedly' until your next turn.",
            "Become the room's official timer: announce each minute.",
            "Wear something on your head until your next turn.",
            "Mirror the next person's gestures for one minute.",
            "Swap your seat with the person directly across.",
            "Let the group pick a word you can't say for 3 rounds.",
            "Do a dramatic gasp every time someone laughs, until your next turn.",
            "Become everyone's echo: repeat the last word they say for 1 minute.",
            "Let the room assign you a catchphrase for the rest of the game.",
            "Stand up every time it's someone else's turn this round.",
            "Switch to your non-dominant hand for everything until your next turn.",
            "Let the player on your right pose you like a statue.",
            "Give a dramatic toast to a random object in the room.",
            "Speak in third person until your next turn.",
            "Let the group restart this round if they chant 'again' together.",
            "Trade one shoe with someone until your next turn.",
            "Declare a 10-second freeze: everyone must hold their pose.",
        ],
        "uk": [
            "Поміняйся одним предметом одягу з гравцем ліворуч.",
            "Усі міняються місцями; ти сідаєш останнім.",
            "Говори лише запитаннями до свого наступного ходу.",
            "Нехай кімната дасть тобі нове ім'я до кінця гри.",
            "Поміняйся телефонами (заблокованими) з кимось до наступного ходу.",
            "Роби все із заплющеними очима до свого наступного ходу.",
            "Додавай драматичний звуковий ефект після кожного мовця 2 хвилини.",
            "Нехай група обере емодзі, який ти промовлятимеш щоходу.",
            "Озвучуй усе, що робиш, до свого наступного ходу.",
            "Поміняйся місцями з тим, хто крутив перед тобою.",
            "Говори лише пошепки, доки не відбудуться ще два спіни.",
            "Нехай кімната придумає 3-секундний танець, який ти робиш щоходу.",
            "Тримайся за руки із сусідом наступний раунд.",
            "Закінчуй кожне речення словом «нібито» до наступного ходу.",
            "Стань офіційним таймером кімнати: оголошуй кожну хвилину.",
            "Носи щось на голові до свого наступного ходу.",
            "Повторюй жести наступної людини протягом хвилини.",
            "Поміняйся місцями з людиною прямо навпроти.",
            "Нехай група обере слово, яке тобі не можна казати 3 раунди.",
            "Драматично ахай щоразу, коли хтось сміється, до наступного ходу.",
            "Стань відлунням: повторюй останнє слово кожного протягом хвилини.",
            "Нехай кімната призначить тобі фразу-візитівку до кінця гри.",
            "Вставай щоразу, коли цього раунду хід іншого гравця.",
            "Роби все недомінантною рукою до свого наступного ходу.",
            "Нехай сусід праворуч поставить тебе в позу статуї.",
            "Виголоси урочистий тост випадковому предмету в кімнаті.",
            "Говори про себе в третій особі до свого наступного ходу.",
            "Нехай група перезапустить раунд, якщо разом скандуватиме «ще».",
            "Поміняйся одним черевиком з кимось до наступного ходу.",
            "Оголоси 10-секундну заморозку: усі завмирають у своїх позах.",
        ],
    },
}


def deck_cards(deck: str, lang: str) -> list[str]:
    """Cards for deck+lang. Falls back: unknown lang → 'en', unknown
    deck → 'mild'. Logs the fallback; never raises (no silent failure)."""
    resolved_deck = deck if deck in DECKS else "mild"
    if resolved_deck != deck:
        log.warning("punishment.unknown_deck", requested=deck)
    langs = DECKS[resolved_deck]
    if lang in langs:
        return langs[lang]
    log.warning("punishment.unknown_lang", requested=lang, deck=resolved_deck)
    return langs["en"]
