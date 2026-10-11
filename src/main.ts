import {
  START,
  END,
  Command,
  StateGraph,
  Annotation,
  MemorySaver,
} from "@langchain/langgraph";
import { BotState, initialState } from "./state.js";
import {
  parseInput,
  lookupTool,
  calculateTool,
  askHuman,
  compose,
  route,
  routeAfterHuman,
} from "./nodes.js";

// Аннотация состояния: каждый ключ — LastValue-канал (последнее значение перезаписывает).
const RootAnnotation = Annotation.Root({
  input: Annotation<string>,
  intent: Annotation<BotState["intent"]>,
  toolResult: Annotation<string>,
  answer: Annotation<string>,
});

/** Схема графа (наглядно показывает требования задачи). */
const SCHEMA = `
  START
   |
   v
 parseInput ──(условное ребро route())──┐
   |  lookup  -> lookupTool ─────────────┼─> compose -> END
   |  calculate -> calculateTool ────────┤
   |  ambiguous -> askHuman ──(routeAfterHuman)──┐
   |     resume "Найти" -> lookupTool  <─────────┘
   |     resume "Посчитать" -> calculateTool <────┘
   |     resume "Завершить" -> END
`;

function buildGraph() {
  const g = new StateGraph(RootAnnotation)
    // Узлы (6 штук в сумме с инструментами и композицией).
    .addNode("parseInput", parseInput)
    .addNode("lookupTool", lookupTool)
    .addNode("calculateTool", calculateTool)
    .addNode("askHuman", askHuman)
    .addNode("compose", compose)
    // Первое условное ребро: маршрутизация по интенту.
    .addConditionalEdges("parseInput", route, {
      lookup: "lookupTool",
      calculate: "calculateTool",
      askHuman: "askHuman",
    })
    // Второе условное ребро: только выход из interrupt-узла.
    .addConditionalEdges("askHuman", routeAfterHuman, {
      lookup: "lookupTool",
      calculate: "calculateTool",
      END: END,
    })
    .addEdge(START, "parseInput")
    .addEdge("lookupTool", "compose")
    .addEdge("calculateTool", "compose")
    .addEdge("compose", END);

  return g.compile({ checkpointer: new MemorySaver() });
}

async function runScenario(
  graph: ReturnType<typeof buildGraph>,
  input: string,
  threadId: string,
  resume?: string,
) {
  const config = { configurable: { thread_id: threadId } };
  const seed: Partial<BotState> = initialState(input);

  console.log(`\n=== Запрос: "${input}" (thread=${threadId}) ===`);

  if (resume !== undefined) {
    // Продолжение после interrupt: передаём ответ человека.
    const resumed = await graph.invoke(new Command({ resume }), config);
    console.log("→ [resume] ", resume, "\nИтоговый ответ узла:",
      (resumed as BotState).answer);
    return;
  }

  const result = (await graph.invoke(seed, config)) as BotState;
  if (result.answer) {
    console.log("Готовый ответ:\n" + result.answer);
  } else {
    // Значит произошёл interrupt — покажем, что граф остановился.
    const state = await graph.getState(config);
    console.log("⏸  Граф остановлен на interrupt.");
    console.log("   Состояние:", state.values);
    if (state.next.length > 0) {
      console.log("   Следующий узел:", state.next.join(", "));
    }
  }
}

async function main() {
  const graph = buildGraph();
  console.log("Схема графа:", SCHEMA);

  // Сценарий 1: маршрут -> поиск (без interrupt).
  await runScenario(graph, "Что по кредиту?", "t1");

  // Сценарий 2: маршрут -> калькулятор (без interrupt).
  await runScenario(graph, "2 + 3 * 4", "t2");

  // Сценарий 3: неоднозначный запрос -> interrupt,
  // затем человек выбирает "Найти информацию".
  await runScenario(graph, "Привет, как дела?", "t3");
  await runScenario(graph, "", "t3", "Найти информацию");

  // Сценарий 4: неоднозначный запрос -> interrupt -> человек завершает.
  await runScenario(graph, "Меня интересует всякое", "t4");
  await runScenario(graph, "", "t4", "Завершить");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
