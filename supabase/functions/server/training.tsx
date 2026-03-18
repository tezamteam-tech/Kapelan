// ─── TRAINING MODULE: Tests, Results, Certification, Level Calculation ────────
import * as kv from "./kv_store.tsx";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface Question {
  id: string;
  text: string;
  type: "single" | "multiple";
  options: string[];
  correctAnswers: number[];      // 0-based option indices
  explanation?: string;
  category: string;
  difficulty: "easy" | "medium" | "hard";
  points: number;
}

export type TestCategory = "installation" | "electrical" | "refrigerant" | "safety" | "ventilation" | "service" | "general";
export type TestDifficulty = "beginner" | "intermediate" | "advanced";

export interface Test {
  id: string;
  title: string;
  description: string;
  category: TestCategory;
  difficulty: TestDifficulty;
  questions: Question[];
  passingScore: number;        // % to pass
  timeLimit: number;           // minutes (0 = unlimited)
  isAnnualCertification: boolean;
  certYear?: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  authorName?: string;
}

export type InstallerLevel = "trainee" | "installer" | "specialist" | "master" | "senior_master";

export interface QuestionResult {
  questionId: string;
  correct: boolean;
  selectedAnswers: number[];
  correctAnswers: number[];
  pointsEarned: number;
  maxPoints: number;
}

export interface TestResult {
  id: string;
  testId: string;
  testTitle: string;
  testCategory: TestCategory;
  isAnnualCertification: boolean;
  certYear?: number;
  installerId: string;
  installerName: string;
  answers: Record<string, number[]>;
  questionResults: QuestionResult[];
  score: number;
  maxScore: number;
  percentage: number;
  passed: boolean;
  level: InstallerLevel;
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
}

export interface InstallerStats {
  installerId: string;
  installerName: string;
  level: InstallerLevel;
  levelLabel: string;
  levelScore: number;           // avg % across all completed tests
  totalTests: number;
  passedTests: number;
  passRate: number;
  annualCertification: {
    year: number;
    status: "passed" | "failed" | "pending";
    percentage?: number;
    completedAt?: string;
  };
  recentResults: {
    resultId: string;
    testTitle: string;
    percentage: number;
    passed: boolean;
    completedAt: string;
  }[];
  categoryScores: Record<string, number>;
}

// ─── Level calculation ────────────────────────────────────────────────────────
export function calcLevel(avgPct: number): InstallerLevel {
  if (avgPct >= 95) return "senior_master";
  if (avgPct >= 85) return "master";
  if (avgPct >= 70) return "specialist";
  if (avgPct >= 50) return "installer";
  return "trainee";
}

export const LEVEL_LABELS: Record<InstallerLevel, string> = {
  trainee:       "Стажер",
  installer:     "Монтажник",
  specialist:    "Специалист",
  master:        "Мастер",
  senior_master: "Старший мастер",
};

export const LEVEL_COLORS: Record<InstallerLevel, string> = {
  trainee:       "#94a3b8",
  installer:     "#3b82f6",
  specialist:    "#10b981",
  master:        "#f59e0b",
  senior_master: "#8b5cf6",
};

// ─── Grade question answers ───────────────────────────────────────────────────
function gradeQuestion(q: Question, selected: number[]): QuestionResult {
  const sortedSel = [...selected].sort();
  const sortedCor = [...q.correctAnswers].sort();
  const correct = JSON.stringify(sortedSel) === JSON.stringify(sortedCor);
  return {
    questionId: q.id,
    correct,
    selectedAnswers: selected,
    correctAnswers: q.correctAnswers,
    pointsEarned: correct ? q.points : 0,
    maxPoints: q.points,
  };
}

// ─── Pre-built question banks ─────────────────────────────────────────────────
const Q_INSTALL: Question[] = [
  {
    id: "i01", text: "Какое минимальное расстояние от потолка до верхнего края внутреннего блока кондиционера?",
    type: "single", options: ["5 см", "10 см", "15 см", "20 см"],
    correctAnswers: [1], explanation: "Минимум 10 см — для нормальной циркуляции воздуха и обслуживания.",
    category: "installation", difficulty: "easy", points: 1,
  },
  {
    id: "i02", text: "Какая максимальная допустимая длина фреоновой трассы для большинства сплит-систем 9000–18000 BTU без дозаправки?",
    type: "single", options: ["5 м", "10 м", "15 м", "25 м"],
    correctAnswers: [3], explanation: "Стандартная длина трассы до 25 м без дозаправки фреона.",
    category: "installation", difficulty: "medium", points: 2,
  },
  {
    id: "i03", text: "Какой уклон дренажного трубопровода правильный для самотечного отвода конденсата?",
    type: "single", options: ["0.5–1° (1 см на 1 м)", "3–5° (5 см на 1 м)", "10–15°", "Уклон не важен"],
    correctAnswers: [0], explanation: "Минимальный уклон 0.5–1° (1 см на п. м.) обеспечивает сток без накопления.",
    category: "installation", difficulty: "medium", points: 2,
  },
  {
    id: "i04", text: "Что необходимо сделать с медными трубами перед подключением?",
    type: "multiple", options: ["Развальцевать концы", "Продуть азотом", "Проверить на герметичность", "Покрасить"],
    correctAnswers: [0, 1, 2], explanation: "Трубы развальцовывают, продувают азотом и проверяют на герметичность.",
    category: "installation", difficulty: "medium", points: 3,
  },
  {
    id: "i05", text: "Каким инструментом выполняют развальцовку медной трубы?",
    type: "single", options: ["Трубогибом", "Вальцовкой", "Труборезом", "Развёрткой"],
    correctAnswers: [1], explanation: "Для развальцовки (расширения) конца медной трубы используют вальцовку.",
    category: "installation", difficulty: "easy", points: 1,
  },
  {
    id: "i06", text: "Какое давление при опрессовке системы азотом считается стандартным?",
    type: "single", options: ["5 бар", "10 бар", "20–30 бар", "40 бар"],
    correctAnswers: [2], explanation: "Стандартная опрессовка — 20–30 бар (2–3 МПа), выдержка не менее 24 ч.",
    category: "installation", difficulty: "medium", points: 2,
  },
  {
    id: "i07", text: "Почему нельзя заполнять систему кислородом при опрессовке?",
    type: "single", options: ["Дорого", "Образует взрывоопасную смесь с маслом компрессора", "Плохо давит", "Можно использовать"],
    correctAnswers: [1], explanation: "Кислород вместе с компрессорным маслом образует взрывоопасную смесь.",
    category: "installation", difficulty: "easy", points: 1,
  },
  {
    id: "i08", text: "Сколько времени нужно вакуумировать систему перед заправкой фреоном?",
    type: "single", options: ["5 мин", "15 мин", "30–60 мин", "Не менее 2 часов"],
    correctAnswers: [2], explanation: "Минимум 30–60 минут до достижения вакуума ≤ 500 мкм рт. ст.",
    category: "installation", difficulty: "medium", points: 2,
  },
  {
    id: "i09", text: "Что означает код ошибки E1 на большинстве кондиционеров?",
    type: "single", options: ["Засорённый фильтр", "Ошибка датчика температуры", "Утечка фреона", "Ошибка связи между блоками"],
    correctAnswers: [3], explanation: "E1/F1 обычно = ошибка связи между внутренним и наружным блоком.",
    category: "installation", difficulty: "hard", points: 3,
  },
  {
    id: "i10", text: "Как правильно выполнить отверстие в стне для прокладки коммуникаций?",
    type: "multiple", options: ["С уклоном наружу 5–10°", "Строго горизонтально", "Запенить после монтажа", "Установить уплотнительную муфту"],
    correctAnswers: [0, 2, 3], explanation: "Отверстие — с уклоном наружу для стока, после — запенить и установить муфту.",
    category: "installation", difficulty: "medium", points: 3,
  },
];

const Q_ELECTRICAL: Question[] = [
  {
    id: "e01", text: "Какое напряжение питания используют большинство бытовых кондиционеров до 7 кВт?",
    type: "single", options: ["110 В / 50 Гц", "220 В / 50 Гц", "380 В / 50 Гц", "220 В / 60 Гц"],
    correctAnswers: [1], explanation: "Стандарт: 220 В / 50 Гц для бытовых кондиционеров.",
    category: "electrical", difficulty: "easy", points: 1,
  },
  {
    id: "e02", text: "Каким должно быть сечение питающего кабеля для кондиционера 12000 BTU (1.3 кВт потребления)?",
    type: "single", options: ["0.75 мм²", "1.5 мм²", "2.5 мм²", "4 мм²"],
    correctAnswers: [1], explanation: "Для тока до 10 А (≤ 2.2 кВт) достаточно 1.5 мм², но 2.5 мм² надёжнее.",
    category: "electrical", difficulty: "medium", points: 2,
  },
  {
    id: "e03", text: "Какие средства защиты обязательны при работе на высоте более 2 метров?",
    type: "multiple", options: ["Страховочный пояс/система", "Каска", "Нескользящая обувь", "Резиновые перчатки"],
    correctAnswers: [0, 1, 2], explanation: "При работе на высоте: страховочный пояс, каска, нескользящая обувь.",
    category: "electrical", difficulty: "easy", points: 2,
  },
  {
    id: "e04", text: "Что такое УЗО и зачем оно нужно для кондиционера?",
    type: "single", options: [
      "Устройство защитного отключения — защита от утечки тока на корпус",
      "Переходный предохранительный выключатель — защита от перегрузки",
      "Пассивный обратный вентилятор — охлаждение блока",
      "Плавкий защитный узел — защита от КЗ",
    ],
    correctAnswers: [0], explanation: "УЗО (RCD) защищает от поражения током при утечке на корпус.",
    category: "electrical", difficulty: "medium", points: 2,
  },
  {
    id: "e05", text: "Какое значение тока утечки УЗО для защиты кондиционера является стандартным?",
    type: "single", options: ["10 мА", "30 мА", "100 мА", "300 мА"],
    correctAnswers: [1], explanation: "30 мА — стандарт для защиты человека от поражения электрическим током.",
    category: "electrical", difficulty: "medium", points: 2,
  },
  {
    id: "e06", text: "Можно ли подключать кондиционер к розетке через удлинитель?",
    type: "single", options: [
      "Да, если удлинитель с заземлением",
      "Да, если есть УЗО",
      "Нет — обязательно отдельная линия с автоматом",
      "Только временно, до 2 часов",
    ],
    correctAnswers: [2], explanation: "Кондиционер требует отдельной линии с автоматом соответствующего номинала.",
    category: "electrical", difficulty: "easy", points: 1,
  },
  {
    id: "e07", text: "Что проверяют мегаомметром перед подключением питания?",
    type: "single", options: ["Мощность потребления", "Сопротивление изоляции кабелей", "Ёмкость конденсаторов", "Параметры компрессора"],
    correctAnswers: [1], explanation: "Мегаомметр измеряет сопротивление изоляции — должно быть ≥ 2 МОм для новых кабелей.",
    category: "electrical", difficulty: "hard", points: 3,
  },
  {
    id: "e08", text: "Какое заземление допустимо для кондиционера?",
    type: "single", options: ["На батарею отопления", "На водопроводную трубу", "На PE-проводник системы TN-C-S", "Заземление не нужно"],
    correctAnswers: [2], explanation: "Правильное заземление — только на PE-шину (защитный проводник). Батарея/труба ЗАПРЕЩЕНЫ.",
    category: "electrical", difficulty: "medium", points: 3,
  },
];

const Q_REFRIGERANT: Question[] = [
  {
    id: "r01", text: "Какой фреон наиболее распространён в современых бытовых сплит-системах?",
    type: "single", options: ["R22", "R407C", "R410A / R32", "R134a"],
    correctAnswers: [2], explanation: "Современные системы используют R410A или R32 как более экологичные альтернативы.",
    category: "refrigerant", difficulty: "easy", points: 1,
  },
  {
    id: "r02", text: "Какие опасности представляет фреон R32?",
    type: "multiple", options: ["Горючий (класс A2L)", "Давление выше чем у R410A", "Удушающий в высоких концентрациях", "Разрушает озоновый слой"],
    correctAnswers: [0, 1, 2], explanation: "R32 — слабогорючий (A2L), давление несколько выше R410A, в больших концентрациях — удушающий. ODP = 0.",
    category: "refrigerant", difficulty: "hard", points: 3,
  },
  {
    id: "r03", text: "Что такое GWP (Global Warming Potential)?",
    type: "single", options: [
      "Давление насыщения фреона при 20°C",
      "Потенциал глобального потепления вещества относительно CO₂",
      "Класс горючести хладагента",
      "Коэффициент теплопроводности",
    ],
    correctAnswers: [1], explanation: "GWP показывает, насколько вещество теплее CO₂ за 100 лет. R32 GWP = 675, R410A GWP = 2088.",
    category: "refrigerant", difficulty: "medium", points: 2,
  },
  {
    id: "r04", text: "Каким методом можно обнаружить утечку фреона?",
    type: "multiple", options: ["Электронным течеискателем", "Мыльным раствором", "УФ-лампой + флуоресцентным красителем", "Понюхать — фреон имеет резкий запах"],
    correctAnswers: [0, 1, 2], explanation: "Течеискатели: электронный, мыльный раствор, УФ+флуоресцент. Фреон не имеет запаха.",
    category: "refrigerant", difficulty: "medium", points: 3,
  },
  {
    id: "r05", text: "Что такое «заправка по массе» и почему это лучше?",
    type: "single", options: [
      "Заправка по показаниям манометров — точнее",
      "Заправка по весу баллона — единственный точный метод для R410A/R32",
      "Заправка до инея на дросселе",
      "Заправка на слух — по звуку компрессора",
    ],
    correctAnswers: [1], explanation: "R410A и R32 — азеотропные смеси, заправляются только жидкостью. Взвешивание — единственный точный метод.",
    category: "refrigerant", difficulty: "hard", points: 3,
  },
  {
    id: "r06", text: "Почему R410A и R32 нельзя смешивать?",
    type: "single", options: [
      "Образуют взрывную смесь",
      "Это разные хладагенты с разными давлениями и маслами",
      "У обоих одинаковое давление — нет смысла",
      "Можно, если в правильной пропорции",
    ],
    correctAnswers: [1], explanation: "Смешивание фреонов недопустимо: разные химические составы, давления, совместимые масла. Повредит компрессор.",
    category: "refrigerant", difficulty: "medium", points: 2,
  },
  {
    id: "r07", text: "Какое значение перегрева на всасывании компрессора является нормой для R410A?",
    type: "single", options: ["0–2°C", "5–10°C", "15–20°C", "25–30°C"],
    correctAnswers: [1], explanation: "Нормальный перегрев: 5–10°C. Меньше — риск гидроудара, больше — перегрев компрессора.",
    category: "refrigerant", difficulty: "hard", points: 3,
  },
];

const Q_SAFETY: Question[] = [
  {
    id: "s01", text: "Что нужно сделать перед любыми работами на электрической части кондиционера?",
    type: "single", options: [
      "Надеть перчатки",
      "Отключить питание и повесить табличку «Не включать!»",
      "Проверить наличие инструмента",
      "Сфотографировать схему подключения",
    ],
    correctAnswers: [1], explanation: "LOTO (Lockout/Tagout): отключить питание и повесить предупредительную табличку.",
    category: "safety", difficulty: "easy", points: 1,
  },
  {
    id: "s02", text: "Какие действия при поражении коллеги электрическим током?",
    type: "multiple", options: [
      "Немедленно отключить питание или оттолкнуть непроводящим предметом",
      "Прикоснуться рукой для проверки",
      "Вызвать скорую помощь",
      "Начать СЛР если пострадавший без сознания",
    ],
    correctAnswers: [0, 2, 3], explanation: "НЕ трогать! Отключить ток, вызвать 103, при необходимости — СЛР.",
    category: "safety", difficulty: "easy", points: 2,
  },
  {
    id: "s03", text: "Какая максимальная масса груза, который один монтажник может поднимать без механизированной помощи?",
    type: "single", options: ["15 кг", "20 кг", "30 кг", "50 кг"],
    correctAnswers: [1], explanation: "По нормам охраны труда: один рабочий — не более 20 кг без вспомогательных средств.",
    category: "safety", difficulty: "easy", points: 1,
  },
  {
    id: "s04", text: "Какое первое действие при утечке фреона в закрытом помещении?",
    type: "single", options: [
      "Найти место утечки",
      "Эвакуироваться и проветрить помещение",
      "Включить вентиляцию кондиционера",
      "Дозаправить больше фреона",
    ],
    correctAnswers: [1], explanation: "Фреон вытесняет кислород. При утечке — немедленная эвакуация и проветривание.",
    category: "safety", difficulty: "medium", points: 2,
  },
  {
    id: "s05", text: "Что такое наряд-допуск и когда он нужен?",
    type: "single", options: [
      "Чек-лист монтажника — всегда",
      "Разрешительный документ для работ с повышенной опасностью (высота > 5 м, электрика > 1000 В и т. д.)",
      "Разрешение от клиента на монтаж",
      "Сертификат на фреон",
    ],
    correctAnswers: [1], explanation: "Наряд-допуск — обязательный документ для опасных работ: высота более 5 м, замкнутые пространства, напряжение > 1000 В.",
    category: "safety", difficulty: "hard", points: 3,
  },
  {
    id: "s06", text: "Какие СИЗ необходимо использовать при пайке медных труб?",
    type: "multiple", options: ["Защитные очки", "Огнестойкие перчатки", "Огнетушитель рядом", "Респиратор"],
    correctAnswers: [0, 1, 2], explanation: "При пайке: очки (брызги флюса), перчатки (ожоги), огнетушитель. Респиратор — при кислотных флюсах.",
    category: "safety", difficulty: "medium", points: 3,
  },
];

const Q_SERVICE: Question[] = [
  {
    id: "sv01", text: "Как часто рекомендуется чистить фильтры кондиционера при нормальной эксплуатации?",
    type: "single", options: ["Еженедельно", "Раз в 2–4 недели", "Раз в 3 месяца", "Раз в год"],
    correctAnswers: [1], explanation: "Фильтры следует чистить каждые 2–4 недели при активном использовании или каждые 2 месяца при умеренном.",
    category: "service", difficulty: "easy", points: 1,
  },
  {
    id: "sv02", text: "Какое техническое обслуживание выполняется при годовом ТО кондиционера?",
    type: "multiple", options: [
      "Чистка теплообменников", "Проверка герметичности системы",
      "Промывка дренажа", "Замена компрессора",
    ],
    correctAnswers: [0, 1, 2], explanation: "Годовое ТО: чистка теплообменников, проверка фреона и герметичности, промывка дренажа, проверка электрики.",
    category: "service", difficulty: "medium", points: 2,
  },
  {
    id: "sv03", text: "Какова причина намерзания льда на внутреннем блоке?",
    type: "multiple", options: [
      "Нехватка фреона", "Засорённый фильтр",
      "Неисправный вентилятор внутреннего блока", "Избыток фреона в системе",
    ],
    correctAnswers: [0, 1, 2], explanation: "Обмерзание: нехватка фреона (падение давления), засорённый фильтр (мало воздуха), неисправный вентилятор.",
    category: "service", difficulty: "medium", points: 3,
  },
  {
    id: "sv04", text: "Шум «щелчка» при запуске кондиционера обычно означает:",
    type: "single", options: [
      "Неисправный компрессор",
      "Нормальное тепловое расширение пластикового корпуса",
      "Перекрученный дренаж",
      "Повышенное давление в системе",
    ],
    correctAnswers: [1], explanation: "Одиночный щелчок при запуске/остановке — нормальное расширение пластика при изменении температуры.",
    category: "service", difficulty: "easy", points: 1,
  },
  {
    id: "sv05", text: "Как проверить правильное заполнение фреоном без весов?",
    type: "multiple", options: [
      "Перегрев на всасывании 5–10°C", "Переохлаждение на жидкостной линии 5–8°C",
      "Давление всасывания по таблице насыщения", "Цвет трубки — должен быть синим",
    ],
    correctAnswers: [0, 1, 2], explanation: "Проверка: перегрев (5–10°C), переохлаждение (5–8°C), давление всасывания по PT-таблице. Цвет трубы не информативен.",
    category: "service", difficulty: "hard", points: 3,
  },
];

// ─── Pre-built tests ──────────────────────────────────────────────────────────
const SEED_TESTS: Test[] = [
  {
    id: "test_basic_install",
    title: "Базовый курс монтажника",
    description: "Основы монтажа сплит-систем: подготовка, инструмент, процедуры установки и подключения.",
    category: "installation",
    difficulty: "beginner",
    questions: Q_INSTALL,
    passingScore: 70,
    timeLimit: 20,
    isAnnualCertification: false,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    authorName: "Система",
  },
  {
    id: "test_electrical_safety",
    title: "Электробезопасность и охрана труда",
    description: "Правила работы с электрикой, СИЗ, действия в аварийных ситуациях.",
    category: "safety",
    difficulty: "intermediate",
    questions: [...Q_ELECTRICAL, ...Q_SAFETY],
    passingScore: 75,
    timeLimit: 25,
    isAnnualCertification: false,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    authorName: "Система",
  },
  {
    id: "test_refrigerant",
    title: "Хладагенты и заправка",
    description: "Типы фреонов, методы заправки, обнаружение утечек, экологические нормы.",
    category: "refrigerant",
    difficulty: "intermediate",
    questions: Q_REFRIGERANT,
    passingScore: 70,
    timeLimit: 15,
    isAnnualCertification: false,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    authorName: "Система",
  },
  {
    id: "test_service",
    title: "Техническое обслуживание",
    description: "Диагностика неисправностей, методы ТО, сезонное обслуживание.",
    category: "service",
    difficulty: "intermediate",
    questions: Q_SERVICE,
    passingScore: 70,
    timeLimit: 15,
    isAnnualCertification: false,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    authorName: "Система",
  },
  {
    id: "test_annual_2026",
    title: "Ежегодная аттестация монтажника 2026",
    description: "Комплексная аттестация: монтаж, электрика, хладагенты, ТО и охрана труда. Обязательна для всех монтажников.",
    category: "general",
    difficulty: "advanced",
    questions: [
      ...Q_INSTALL.slice(0, 5),
      ...Q_ELECTRICAL.slice(0, 4),
      ...Q_REFRIGERANT.slice(0, 4),
      ...Q_SAFETY.slice(0, 4),
      ...Q_SERVICE.slice(0, 3),
    ],
    passingScore: 80,
    timeLimit: 40,
    isAnnualCertification: true,
    certYear: 2026,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    authorName: "Система",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function uid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function getAllTests(): Promise<Test[]> {
  const vals = await kv.getByPrefix("kapelan_test:") as string[];
  return vals.map(v => { try { return JSON.parse(v); } catch { return null; } }).filter(Boolean);
}

async function getAllResults(): Promise<TestResult[]> {
  const vals = await kv.getByPrefix("kapelan_result:") as string[];
  return vals.map(v => { try { return JSON.parse(v); } catch { return null; } }).filter(Boolean);
}

async function ensureSeeded(): Promise<void> {
  const existing = await kv.get("kapelan_seeded_v2");
  if (existing) return;
  for (const t of SEED_TESTS) {
    await kv.set(`kapelan_test:${t.id}`, JSON.stringify(t));
  }
  await kv.set("kapelan_seeded_v2", "1");
  // Remove old seed flag so we don't duplicate
  await kv.del("kapelan_seeded_v1");
  console.log("[training] seeded default tests (v2 — Russian)");
}

// ─── Stats builder ───────────────────────────────────────────────────────────
async function buildInstallerStats(installerName: string, year: number): Promise<InstallerStats> {
  const results = (await getAllResults()).filter(r => r.installerName === installerName);
  const installerId = results[0]?.installerId ?? installerName.toLowerCase().replace(/\s+/g, "_");

  const totalTests = results.length;
  const passedTests = results.filter(r => r.passed).length;
  const passRate = totalTests > 0 ? Math.round(passedTests / totalTests * 100) : 0;
  const avgPct = totalTests > 0 ? Math.round(results.reduce((s, r) => s + r.percentage, 0) / totalTests) : 0;

  const level = calcLevel(avgPct);

  // By category
  const catMap: Record<string, number[]> = {};
  for (const r of results) {
    if (!catMap[r.testCategory]) catMap[r.testCategory] = [];
    catMap[r.testCategory].push(r.percentage);
  }
  const categoryScores: Record<string, number> = {};
  for (const [cat, scores] of Object.entries(catMap)) {
    categoryScores[cat] = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }

  // Annual cert
  const certResult = results
    .filter(r => r.isAnnualCertification && r.certYear === year)
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())[0];

  const annualCertification = certResult
    ? { year, status: certResult.passed ? "passed" as const : "failed" as const, percentage: certResult.percentage, completedAt: certResult.completedAt }
    : { year, status: "pending" as const };

  // Recent
  const recentResults = results
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
    .slice(0, 5)
    .map(r => ({ resultId: r.id, testTitle: r.testTitle, percentage: r.percentage, passed: r.passed, completedAt: r.completedAt }));

  return {
    installerId,
    installerName,
    level,
    levelLabel: LEVEL_LABELS[level],
    levelScore: avgPct,
    totalTests,
    passedTests,
    passRate,
    annualCertification,
    recentResults,
    categoryScores,
  };
}

// ─── Register routes ──────────────────────────────────────────────────────────
export function registerTrainingRoutes(app: any): void {
  const P = "/make-server-1df47c03";

  // ── Tests ──────────────────────────────────────────────────────────────────

  // GET /training/tests
  app.get(`${P}/training/tests`, async (c: any) => {
    try {
      await ensureSeeded();
      const tests = await getAllTests();
      const activeOnly = c.req.query("active") !== "false";
      const filtered = activeOnly ? tests.filter(t => t.active) : tests;
      // Strip questions for list view
      const list = filtered.map(t => ({
        id: t.id, title: t.title, description: t.description,
        category: t.category, difficulty: t.difficulty,
        questionsCount: t.questions.length, passingScore: t.passingScore,
        timeLimit: t.timeLimit, isAnnualCertification: t.isAnnualCertification,
        certYear: t.certYear, active: t.active,
        createdAt: t.createdAt, authorName: t.authorName,
      }));
      return c.json({ tests: list });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // GET /training/tests/:id
  app.get(`${P}/training/tests/:id`, async (c: any) => {
    try {
      await ensureSeeded();
      const raw = await kv.get(`kapelan_test:${c.req.param("id")}`);
      if (!raw) return c.json({ error: "Тест не найден" }, 404);
      return c.json({ test: JSON.parse(raw) });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // POST /training/tests
  app.post(`${P}/training/tests`, async (c: any) => {
    try {
      const body = await c.req.json();
      const test: Test = {
        id: `test_${uid()}`,
        title: body.title ?? "Новый тест",
        description: body.description ?? "",
        category: body.category ?? "general",
        difficulty: body.difficulty ?? "beginner",
        questions: body.questions ?? [],
        passingScore: Number(body.passingScore) || 70,
        timeLimit: Number(body.timeLimit) || 0,
        isAnnualCertification: Boolean(body.isAnnualCertification),
        certYear: body.certYear,
        active: body.active !== false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        authorName: body.authorName ?? "Администратор",
      };
      await kv.set(`kapelan_test:${test.id}`, JSON.stringify(test));
      return c.json({ test });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // PUT /training/tests/:id
  app.put(`${P}/training/tests/:id`, async (c: any) => {
    try {
      const raw = await kv.get(`kapelan_test:${c.req.param("id")}`);
      if (!raw) return c.json({ error: "Тест не найден" }, 404);
      const existing: Test = JSON.parse(raw);
      const body = await c.req.json();
      const updated: Test = { ...existing, ...body, id: existing.id, updatedAt: new Date().toISOString() };
      await kv.set(`kapelan_test:${updated.id}`, JSON.stringify(updated));
      return c.json({ test: updated });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // DELETE /training/tests/:id
  app.delete(`${P}/training/tests/:id`, async (c: any) => {
    try {
      await kv.del(`kapelan_test:${c.req.param("id")}`);
      return c.json({ success: true });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // ── Results ────────────────────────────────────────────────────────────────

  // POST /training/results — submit test result
  app.post(`${P}/training/results`, async (c: any) => {
    try {
      await ensureSeeded();
      const body = await c.req.json();
      const rawTest = await kv.get(`kapelan_test:${body.testId}`);
      if (!rawTest) return c.json({ error: "Тест не найден" }, 404);
      const test: Test = JSON.parse(rawTest);
      const answers: Record<string, number[]> = body.answers ?? {};

      let score = 0;
      const maxScore = test.questions.reduce((s, q) => s + q.points, 0);
      const questionResults: QuestionResult[] = test.questions.map(q => {
        const gr = gradeQuestion(q, answers[q.id] ?? []);
        score += gr.pointsEarned;
        return gr;
      });

      const percentage = maxScore > 0 ? Math.round(score / maxScore * 100) : 0;
      const passed = percentage >= test.passingScore;

      // Calc installer's overall level after this result
      const installerName: string = body.installerName ?? "Монтажник";
      const installerId: string = installerName.toLowerCase().replace(/\s+/g, "_");
      const prevResults = (await getAllResults()).filter(r => r.installerName === installerName);
      const allPcts = [...prevResults.map(r => r.percentage), percentage];
      const avgPct = Math.round(allPcts.reduce((a, b) => a + b, 0) / allPcts.length);
      const level = calcLevel(avgPct);

      const startedAt: string = body.startedAt ?? new Date(Date.now() - 60000).toISOString();
      const completedAt = new Date().toISOString();
      const durationSeconds = Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000);

      const result: TestResult = {
        id: `result_${uid()}`,
        testId: test.id,
        testTitle: test.title,
        testCategory: test.category,
        isAnnualCertification: test.isAnnualCertification,
        certYear: test.certYear,
        installerId,
        installerName,
        answers,
        questionResults,
        score,
        maxScore,
        percentage,
        passed,
        level,
        startedAt,
        completedAt,
        durationSeconds,
      };

      await kv.set(`kapelan_result:${result.id}`, JSON.stringify(result));
      console.log(`[training] result: ${installerName} → ${test.title}: ${percentage}% (${passed ? "PASSED" : "FAILED"})`);
      return c.json({ result });
    } catch (e: any) {
      console.error("[training] submit error:", e);
      return c.json({ error: e.message }, 500);
    }
  });

  // GET /training/results — list with optional filters
  app.get(`${P}/training/results`, async (c: any) => {
    try {
      let results = await getAllResults();
      const q = c.req.query;
      if (q("installerName")) results = results.filter(r => r.installerName === q("installerName"));
      if (q("testId")) results = results.filter(r => r.testId === q("testId"));
      if (q("year")) results = results.filter(r => {
        const y = new Date(r.completedAt).getFullYear();
        return String(y) === q("year");
      });
      results.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
      const light = results.map(r => ({
        id: r.id, testId: r.testId, testTitle: r.testTitle, testCategory: r.testCategory,
        isAnnualCertification: r.isAnnualCertification, certYear: r.certYear,
        installerName: r.installerName, percentage: r.percentage, score: r.score,
        maxScore: r.maxScore, passed: r.passed, level: r.level,
        completedAt: r.completedAt, durationSeconds: r.durationSeconds,
      }));
      return c.json({ results: light });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // GET /training/results/:id
  app.get(`${P}/training/results/:id`, async (c: any) => {
    try {
      const raw = await kv.get(`kapelan_result:${c.req.param("id")}`);
      if (!raw) return c.json({ error: "Результат не найден" }, 404);
      return c.json({ result: JSON.parse(raw) });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // ── Stats & Certification ──────────────────────────────────────────────────

  // GET /training/stats/:installerName
  app.get(`${P}/training/stats/:installerName`, async (c: any) => {
    try {
      const year = Number(c.req.query("year")) || new Date().getFullYear();
      const stats = await buildInstallerStats(decodeURIComponent(c.req.param("installerName")), year);
      return c.json({ stats });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // GET /training/certification/:year — all installers' certification status
  app.get(`${P}/training/certification/:year`, async (c: any) => {
    try {
      const year = Number(c.req.param("year"));
      const results = await getAllResults();
      const names = [...new Set(results.map(r => r.installerName))];
      const certList = await Promise.all(names.map(async name => {
        const stats = await buildInstallerStats(name, year);
        return {
          installerName: name,
          level: stats.level,
          levelLabel: stats.levelLabel,
          levelScore: stats.levelScore,
          certification: stats.annualCertification,
          totalTests: stats.totalTests,
        };
      }));
      certList.sort((a, b) => b.levelScore - a.levelScore);
      return c.json({ year, installers: certList });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });

  // GET /training/leaderboard
  app.get(`${P}/training/leaderboard`, async (c: any) => {
    try {
      const results = await getAllResults();
      const names = [...new Set(results.map(r => r.installerName))];
      const year = new Date().getFullYear();
      const board = await Promise.all(names.map(async name => {
        const s = await buildInstallerStats(name, year);
        return { installerName: name, level: s.level, levelLabel: s.levelLabel, levelScore: s.levelScore, totalTests: s.totalTests, passRate: s.passRate };
      }));
      board.sort((a, b) => b.levelScore - a.levelScore);
      return c.json({ leaderboard: board });
    } catch (e: any) {
      return c.json({ error: e.message }, 500);
    }
  });
}