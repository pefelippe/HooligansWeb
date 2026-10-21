// Disponível no Node >= 17 e em todos os navegadores; declarado aqui para o shared não depender de lib DOM nem @types/node.
declare function structuredClone<T>(value: T): T;
declare const performance: { now(): number };
