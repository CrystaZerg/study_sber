/**
 * Состояние графа. Все узлы читают его и возвращают обновлённые части
 * (частичное обновление — типичный для LangGraph паттерн).
 */
export interface BotState {
  /** Сырой ввод пользователя */
  input: string;
  /** Распознанный интент: поиск ('lookup') / расчёт ('calculate') / неоднозначно ('ambiguous') */
  intent: "lookup" | "calculate" | "ambiguous" | null;
  /** Промежуточные результаты инструментов */
  toolResult: string;
  /** Итоговый ответ для пользователя */
  answer: string;
}

export function initialState(input: string): Partial<BotState> {
  return { input, intent: null, toolResult: "", answer: "" };
}

/**
 * Структура значения, которое узел возвращает из interrupt():
 * вопрос человеку + варианты ответа. Пользователь продолжает граф,
 * передав выбранный вариант как `Command(resume: ...)`.
 */
export interface InterruptPayload {
  message: string;
  options: string[];
}
