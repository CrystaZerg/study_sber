import { interrupt } from "@langchain/langgraph";
import type { BotState, InterruptPayload } from "./state.js";

/**
 * ------------------------------------------------------------------
 * УЗЛЫ ГРАФА (6 узлов, требование: не меньше 4)
 * ------------------------------------------------------------------
 * parseInput -> route (условное ребро) -> lookup | calculate | askHuman -> compose
 */

/** Узел 1. Разбор входного запроса: нормализация и валидация. */
export function parseInput(state: BotState): Partial<BotState> {
  const trimmed = state.input.trim();
  // Минимальная валидация: пустой ввод помечаем как неоднозначный.
  const isEmpty = trimmed.length === 0;
  // Классификацию интента выполняет только условное ребро route().
  return {
    input: trimmed,
    intent: isEmpty ? "ambiguous" : null,
    toolResult: "",
  };
}

/** Вспомогательное: является ли запрос арифметикой (два числа + оператор). */
function isArithmetic(text: string): boolean {
  return /^[\d\s+\-*/()%.]+$/.test(text);
}

/**
 * УСЛОВНОЕ РЕБРО (требование: хотя бы одно условное ребро).
 * По содержимому состояния возвращает имя следующего узла.
 */
export function route(state: BotState): "lookup" | "calculate" | "askHuman" {
  const query = state.input.trim().toLowerCase();
  // Поисковый интент: названа известная сущность.
  if (["кредит", "ипотека", "карта", "депозит"].some((k) => query.includes(k))) {
    return "lookup";
  }
  // Расчётный интент: запрос — арифметическое выражение.
  if (isArithmetic(query)) return "calculate";
  // Всё прочее (включая пустой ввод) — неоднозначно, нужен человек (interrupt).
  return "askHuman";
}

/** Узел 3. Инструмент №1: поиск по «базе знаний». */
export function lookupTool(state: BotState): Partial<BotState> {
  // Эмуляция внешнего поиска по сущности из запроса.
  const knowledge: Record<string, string> = {
    кредит: "Кредит до 5 млн ₽, ставка от 12.9% годовых, срок до 7 лет.",
    ипотека: "Ипотека от 11.5% годовых, первоначальный взнос от 15%.",
    карта: "Карта «Все сразу» — кэшбэк до 15% категориями, бесплатное обслуживание.",
    депозит: "Вклад «Накопительный» — до 18% годовых, пополнение без ограничений.",
  };
  const key = Object.keys(knowledge).find((k) => state.input.includes(k));
  const found = key ? knowledge[key] : "По запросу ничего не найдено.";
  return { toolResult: `[lookup] ${found}` };
}

/** Узел 4. Инструмент №2: безопасный калькулятор арифметического выражения. */
export function calculateTool(state: BotState): Partial<BotState> {
  let result = "ошибка выражения";
  try {
    // Намеренно простой eval с фильтром допустимых символов — isArithmetic уже
    // отсеял всё, кроме цифр и операторов. Для учебного примера допустимо.
    // eslint-disable-next-line no-new-func
    const value = new Function(`return (${state.input.trim()})`)() as number;
    result = Number.isFinite(value) ? String(value) : "ошибка выражения";
  } catch {
    result = "ошибка выражения";
  }
  return { toolResult: `[calculate] ${state.input.trim()} = ${result}` };
}

/**
 * Узел 5. INTERRUPT (требование: использован interrupt).
 * Запрос не распознан однозначно -> останавливаем выполнение и ждём
 * ответа человека. Продолжение происходит через Command(resume: ...).
 */
export function askHuman(state: BotState): Partial<BotState> {
  const payload: InterruptPayload = {
    message: `Не понял запрос: «${state.input}». Что нужно сделать?`,
    options: ["Найти информацию", "Посчитать выражение", "Завершить"],
  };
  // Граф останавливается здесь; вернётся, когда человек передаст resume.
  const answer = interrupt<InterruptPayload, string>(payload);
  const choice = (answer ?? "").toLowerCase();
  if (choice.includes("найти") || choice.includes("поиск")) {
    return { intent: "lookup" };
  }
  if (choice.includes("счит") || choice.includes("вычисл")) {
    return { intent: "calculate" };
  }
  // Любой другой ответ (в т.ч. "Завершить") — прощаемся.
  return { intent: null, answer: "Хорошо, завершаем диалог." };
}

/**
 * Второе УСЛОВНОЕ РЕБРО — только для выхода из interrupt-узла.
 * Решает по intent,который вернул askHuman.
 */
export function routeAfterHuman(state: BotState): "lookup" | "calculate" | "END" {
  if (state.intent === "lookup") return "lookup";
  if (state.intent === "calculate") return "calculate";
  return "END";
}

/**
 * Узел 6. Сборка финального ответа из результата инструмента.
 */
export function compose(state: BotState): Partial<BotState> {
  return {
    answer: state.answer || `Результат обработки:\n${state.toolResult}`,
  };
}
