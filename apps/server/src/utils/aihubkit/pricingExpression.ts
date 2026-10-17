import { parseExpression } from "@babel/parser";

export interface AihubkitPricingDimensions {
  resolutionTier: string;
  seconds: number;
  units: number;
  inputImageCount: number;
  inputVideoCount: number;
  inputVideoSeconds: number;
  inputAudioCount: number;
  inputAudioSeconds: number;
  referenceImageCount: number;
  referenceVideoCount: number;
  referenceAudioCount: number;
}

export interface AihubkitExpressionPrice {
  amount: number;
  tier: string;
  deferred: boolean;
}

export interface AihubkitExpressionSummary {
  label: string;
  tips: string;
  kind: "fixed" | "perSecond" | "tokenEstimate" | "dynamic";
}

type AstNode = Record<string, unknown>;
type DeferredValue = { type: "deferred"; amount: number };
type Evaluation = number | string | boolean | DeferredValue | AihubkitExpressionPrice;

const maxExpressionLength = 20_000;
const maxDepth = 64;
const dimensionNames: Record<string, keyof AihubkitPricingDimensions> = {
  resolution_tier: "resolutionTier",
  seconds: "seconds",
  units: "units",
  input_image_count: "inputImageCount",
  input_video_count: "inputVideoCount",
  input_video_seconds: "inputVideoSeconds",
  input_audio_count: "inputAudioCount",
  input_audio_seconds: "inputAudioSeconds",
  reference_image_count: "referenceImageCount",
  reference_video_count: "referenceVideoCount",
  reference_audio_count: "referenceAudioCount",
};

export const emptyAihubkitPricingDimensions: AihubkitPricingDimensions = {
  resolutionTier: "",
  seconds: 0,
  units: 1,
  inputImageCount: 0,
  inputVideoCount: 0,
  inputVideoSeconds: 0,
  inputAudioCount: 0,
  inputAudioSeconds: 0,
  referenceImageCount: 0,
  referenceVideoCount: 0,
  referenceAudioCount: 0,
};

function object(value: unknown): AstNode | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AstNode : undefined;
}

function finite(value: Evaluation | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function truthy(value: Evaluation | undefined) {
  return typeof value === "boolean" ? value : typeof value === "number" ? value !== 0 : typeof value === "string" ? Boolean(value) : undefined;
}

function parse(expression: string) {
  if (!expression || expression.length > maxExpressionLength) return;
  const source = expression.replace(/^v\d+:/, "");
  try {
    return parseExpression(source) as unknown as AstNode;
  } catch {
    return;
  }
}

function evaluateBinary(operator: string, left: Evaluation, right: Evaluation): Evaluation | undefined {
  if (["==", "===", "!=", "!=="].includes(operator)) {
    const equal = typeof left === typeof right && left === right;
    return operator === "!=" || operator === "!==" ? !equal : equal;
  }
  if (["<", "<=", ">", ">="].includes(operator)) {
    if ((typeof left !== "number" && typeof left !== "string") || typeof left !== typeof right) return;
    if (operator === "<") return left < right;
    if (operator === "<=") return left <= right;
    if (operator === ">") return left > right;
    return left >= right;
  }
  const leftNumber = finite(left);
  const rightNumber = finite(right);
  if (leftNumber === undefined || rightNumber === undefined) return;
  if (operator === "+") return leftNumber + rightNumber;
  if (operator === "-") return leftNumber - rightNumber;
  if (operator === "*") return leftNumber * rightNumber;
  if (operator === "/" && rightNumber !== 0) return leftNumber / rightNumber;
  return;
}

function evaluateCall(node: AstNode, dimensions: AihubkitPricingDimensions, depth: number): Evaluation | undefined {
  const callee = object(node.callee);
  const name = callee?.type === "Identifier" && typeof callee.name === "string" ? callee.name : "";
  const args = Array.isArray(node.arguments) ? node.arguments.map(object) : [];
  if (!name || args.some(argument => !argument)) return;
  if (name === "deferred") {
    if (args.length !== 2) return;
    const fallback = evaluateNode(args[1]!, dimensions, depth + 1);
    const amount = finite(fallback);
    return amount === undefined ? undefined : { type: "deferred", amount };
  }
  if (name === "max") {
    if (!args.length || args.length > 20) return;
    const values = args.map(argument => finite(evaluateNode(argument!, dimensions, depth + 1)));
    return values.some(value => value === undefined) ? undefined : Math.max(...values as number[]);
  }
  if (name === "usd") {
    if (args.length !== 1) return;
    return finite(evaluateNode(args[0]!, dimensions, depth + 1));
  }
  if (name === "tier") {
    if (args.length !== 2) return;
    const tier = evaluateNode(args[0]!, dimensions, depth + 1);
    const value = evaluateNode(args[1]!, dimensions, depth + 1);
    if (typeof tier !== "string" || !tier.trim() || tier.length > 200) return;
    if (object(value)?.type === "deferred") {
      const amount = finite((value as DeferredValue).amount);
      return amount === undefined || amount < 0 ? undefined : { amount, tier: tier.trim(), deferred: true };
    }
    const amount = finite(value);
    return amount === undefined || amount < 0 ? undefined : { amount, tier: tier.trim(), deferred: false };
  }
}

function evaluateNode(node: AstNode, dimensions: AihubkitPricingDimensions, depth = 0): Evaluation | undefined {
  if (depth > maxDepth) return;
  if (node.type === "NumericLiteral") return typeof node.value === "number" && Number.isFinite(node.value) ? node.value : undefined;
  if (node.type === "StringLiteral") return typeof node.value === "string" ? node.value : undefined;
  if (node.type === "BooleanLiteral") return typeof node.value === "boolean" ? node.value : undefined;
  if (node.type === "Identifier" && typeof node.name === "string") {
    const key = dimensionNames[node.name];
    return key ? dimensions[key] : undefined;
  }
  if (node.type === "UnaryExpression" && (node.operator === "+" || node.operator === "-")) {
    const value = finite(evaluateNode(object(node.argument) ?? {}, dimensions, depth + 1));
    return value === undefined ? undefined : node.operator === "-" ? -value : value;
  }
  if (node.type === "BinaryExpression") {
    const left = evaluateNode(object(node.left) ?? {}, dimensions, depth + 1);
    const right = evaluateNode(object(node.right) ?? {}, dimensions, depth + 1);
    return left === undefined || right === undefined || typeof node.operator !== "string" ? undefined : evaluateBinary(node.operator, left, right);
  }
  if (node.type === "LogicalExpression" && (node.operator === "&&" || node.operator === "||")) {
    const left = truthy(evaluateNode(object(node.left) ?? {}, dimensions, depth + 1));
    if (left === undefined) return;
    if (node.operator === "&&") return left ? evaluateNode(object(node.right) ?? {}, dimensions, depth + 1) : false;
    return left ? true : evaluateNode(object(node.right) ?? {}, dimensions, depth + 1);
  }
  if (node.type === "ConditionalExpression") {
    const condition = truthy(evaluateNode(object(node.test) ?? {}, dimensions, depth + 1));
    if (condition === undefined) return;
    return evaluateNode(object(condition ? node.consequent : node.alternate) ?? {}, dimensions, depth + 1);
  }
  if (node.type === "CallExpression") return evaluateCall(node, dimensions, depth);
}

function tierCalls(node: AstNode, result: AstNode[] = [], depth = 0) {
  if (depth > maxDepth) return result;
  if (node.type === "CallExpression") {
    const callee = object(node.callee);
    if (callee?.type === "Identifier" && callee.name === "tier") result.push(node);
    else if (Array.isArray(node.arguments)) for (const argument of node.arguments) {
      const child = object(argument);
      if (child) tierCalls(child, result, depth + 1);
    }
    return result;
  }
  const childNames = node.type === "ConditionalExpression" ? ["consequent", "alternate"]
    : node.type === "LogicalExpression" || node.type === "BinaryExpression" ? ["left", "right"]
      : node.type === "UnaryExpression" ? ["argument"] : [];
  for (const name of childNames) {
    const child = object(node[name]);
    if (child) tierCalls(child, result, depth + 1);
  }
  return result;
}

function formatAmount(value: number) {
  return Number(value.toFixed(6)).toString();
}

function evaluatedTier(node: AstNode, changes: Partial<AihubkitPricingDimensions> = {}) {
  const value = evaluateNode(node, { ...emptyAihubkitPricingDimensions, seconds: 1, ...changes });
  return object(value) && typeof (value as AihubkitExpressionPrice).amount === "number" ? value as AihubkitExpressionPrice : undefined;
}

export function evaluateAihubkitExpression(expression: string, dimensions: AihubkitPricingDimensions): AihubkitExpressionPrice | null {
  const ast = parse(expression);
  if (!ast) return null;
  const value = evaluateNode(ast, dimensions);
  if (!object(value) || typeof (value as AihubkitExpressionPrice).tier !== "string") return null;
  const price = value as AihubkitExpressionPrice;
  return Number.isFinite(price.amount) && price.amount >= 0 ? price : null;
}

export function summarizeAihubkitExpression(expression: string, ratio: number): AihubkitExpressionSummary | null {
  const ast = parse(expression);
  if (!ast || !Number.isFinite(ratio) || ratio < 0) return null;
  const tiers = tierCalls(ast);
  const evaluated = tiers.flatMap(tier => {
    const base = evaluatedTier(tier);
    return base ? [{ tier, base }] : [];
  });
  if (!evaluated.length) return null;
  const minimum = Math.min(...evaluated.map(value => value.base.amount)) * ratio;
  const deferred = evaluated.some(value => value.base.deferred);
  const perSecond = evaluated.some(({ tier, base }) => {
    const next = evaluatedTier(tier, { seconds: 2 });
    return next && Math.abs(next.amount - base.amount) > 1e-9;
  });
  const dynamic = evaluated.some(({ tier, base }) => [{ inputVideoSeconds: 1 }, { inputAudioSeconds: 1 }, { inputImageCount: 10 }].some(change => {
    const next = evaluatedTier(tier, change);
    return next && Math.abs(next.amount - base.amount) > 1e-9;
  }));
  const ratioTip = `当前账号分组倍率 ${formatAmount(ratio)}×`;
  if (deferred) return {
    label: `按 Token · 参考 ${formatAmount(minimum)}/${perSecond ? "秒" : "次"}起`,
    tips: `按 Token 最终结算；生成前使用上游参考公式估算；${ratioTip}；最终以实际扣费为准。`,
    kind: "tokenEstimate",
  };
  if (perSecond) return {
    label: `${formatAmount(minimum)}/秒起`,
    tips: `按输出时长和所选清晰度计算${dynamic ? "，参考素材可能产生附加费用" : ""}；${ratioTip}；最终以实际扣费为准。`,
    kind: "perSecond",
  };
  return {
    label: `${formatAmount(minimum)}/次起`,
    tips: `${dynamic ? "价格随参考素材变化" : "按次计费"}；${ratioTip}；最终以实际扣费为准。`,
    kind: dynamic ? "dynamic" : "fixed",
  };
}
