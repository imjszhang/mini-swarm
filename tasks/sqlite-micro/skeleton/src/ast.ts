export type OrderDirection = "ASC" | "DESC";

export interface ColumnDef {
  name: string;
  declaredType: string;
}

export interface LiteralExpr {
  kind: "literal";
  value: null | number | string;
}

export interface ColumnRefExpr {
  kind: "column_ref";
  table?: string;
  column: string;
}

export interface BinaryOpExpr {
  kind: "binary_op";
  op: string;
  left: Expr;
  right: Expr;
}

export interface UnaryOpExpr {
  kind: "unary_op";
  op: string;
  operand: Expr;
}

export interface FunctionCallExpr {
  kind: "function_call";
  name: string;
  args: Expr[];
  distinct?: boolean;
}

export interface WhenClause {
  condition: Expr;
  result: Expr;
}

export interface CaseExpr {
  kind: "case";
  operand?: Expr;
  whenClauses: WhenClause[];
  elseResult?: Expr;
}

export interface CastExpr {
  kind: "cast";
  expr: Expr;
  targetType: string;
}

export interface BetweenExpr {
  kind: "between";
  expr: Expr;
  lower: Expr;
  upper: Expr;
  not?: boolean;
}

export interface InExpr {
  kind: "in";
  expr: Expr;
  values: Expr[];
  not?: boolean;
}

export interface LikeExpr {
  kind: "like";
  expr: Expr;
  pattern: Expr;
  escape?: Expr;
  not?: boolean;
}

export interface IsNullExpr {
  kind: "is_null";
  expr: Expr;
  not?: boolean;
}

export type Expr =
  | LiteralExpr
  | ColumnRefExpr
  | BinaryOpExpr
  | UnaryOpExpr
  | FunctionCallExpr
  | CaseExpr
  | CastExpr
  | BetweenExpr
  | InExpr
  | LikeExpr
  | IsNullExpr;

export interface OrderByItem {
  expr: Expr;
  direction?: OrderDirection;
}

export interface SelectItem {
  expr: Expr;
  alias?: string;
}

export interface CreateTableStmt {
  kind: "create_table";
  name: string;
  columns: ColumnDef[];
}

export interface InsertStmt {
  kind: "insert";
  table: string;
  columns?: string[];
  values: Expr[][];
}

export interface SelectStmt {
  kind: "select";
  distinct?: boolean;
  columns: SelectItem[];
  from?: string;
  where?: Expr;
  orderBy?: OrderByItem[];
  limit?: Expr;
  offset?: Expr;
}

export interface UpdateAssignment {
  column: string;
  value: Expr;
}

export interface UpdateStmt {
  kind: "update";
  table: string;
  assignments: UpdateAssignment[];
  where?: Expr;
}

export interface DeleteStmt {
  kind: "delete";
  table: string;
  where?: Expr;
}

export type Stmt =
  | CreateTableStmt
  | InsertStmt
  | SelectStmt
  | UpdateStmt
  | DeleteStmt;
