/**
 * t Language - AST Node Definitions
 *
 * Complete AST node types covering all language constructs:
 * - Declarations (struct, enum, flag, union, func, var, const, import)
 * - Statements (if, for, while, switch, return, break, continue, defer, expr, decl)
 * - Expressions (literals, identifiers, binary, unary, call, member, index, etc.)
 * - Types (scalar, array, slice, map, custom, variant)
 * - Annotations (@derive, @test, @cfg, etc.)
 * - Flag/bitfield declarations
 *
 * Spec reference: sections 1-8
 */
export function walkDecl(decl, fn) {
    fn(decl);
    const dk = decl.declKind;
    switch (dk.kind) {
        case "StructDecl":
            dk.fields.forEach((f) => {
                fn(f.typeNode);
                f.annotations.forEach((a) => fn(a));
            });
            break;
        case "EnumDecl":
            dk.variants.forEach((v) => {
                if (v.value)
                    fn(v.value);
                v.annotations.forEach((a) => fn(a));
            });
            break;
        case "FlagDecl":
        case "FlagSetDecl":
            dk.slots.forEach((s) => s.annotations.forEach((a) => fn(a)));
            break;
        case "UnionDecl":
            dk.members.forEach((m) => {
                fn(m.typeNode);
                m.annotations.forEach((a) => fn(a));
            });
            break;
        case "FuncDecl":
            dk.params.forEach((p) => {
                fn(p.typeNode);
                p.annotations.forEach((a) => fn(a));
            });
            fn(dk.returnType);
            if (dk.body)
                dk.body.forEach((s) => walkStmt(s, fn));
            break;
        case "GlobalVarDecl":
            fn(dk.typeNode);
            if (dk.init)
                fn(dk.init);
            break;
        case "GlobalConstDecl":
            if (dk.typeNode)
                fn(dk.typeNode);
            fn(dk.init);
            break;
        case "TypeAliasDecl":
            fn(dk.aliasedType);
            break;
    }
    decl.annotations.forEach((a) => fn(a));
}
export function walkStmt(stmt, fn) {
    fn(stmt);
    const sk = stmt.stmtKind;
    switch (sk.kind) {
        case "ExprStmt":
            fn(sk.expr);
            break;
        case "VarDecl":
            if (sk.typeNode)
                fn(sk.typeNode);
            if (sk.init)
                fn(sk.init);
            break;
        case "IfStmt":
            fn(sk.condition);
            sk.thenBlock.forEach((s) => walkStmt(s, fn));
            if (sk.elseBlock)
                sk.elseBlock.forEach((s) => walkStmt(s, fn));
            break;
        case "ForStmt":
            if (sk.init)
                walkStmt(sk.init, fn);
            if (sk.condition)
                fn(sk.condition);
            if (sk.update)
                fn(sk.update);
            sk.body.forEach((s) => walkStmt(s, fn));
            break;
        case "ForEachStmt":
            fn(sk.iterable);
            sk.body.forEach((s) => walkStmt(s, fn));
            break;
        case "WhileStmt":
            fn(sk.condition);
            sk.body.forEach((s) => walkStmt(s, fn));
            break;
        case "SwitchStmt":
            fn(sk.expr);
            sk.cases.forEach((c) => {
                fn(c.pattern);
                c.body.forEach((s) => walkStmt(s, fn));
            });
            if (sk.defaultBlock)
                sk.defaultBlock.forEach((s) => walkStmt(s, fn));
            break;
        case "ReturnStmt":
            if (sk.value)
                fn(sk.value);
            break;
        case "DeferStmt":
        case "BlockStmt":
        case "ComptimeStmt":
            sk.body.forEach((s) => walkStmt(s, fn));
            break;
        case "AssignmentStmt":
            fn(sk.target);
            fn(sk.value);
            break;
    }
}
export function walkExpr(expr, fn) {
    fn(expr);
    const ek = expr.exprKind;
    switch (ek.kind) {
        case "BinaryExpr":
            walkExpr(ek.left, fn);
            walkExpr(ek.right, fn);
            break;
        case "UnaryExpr":
            walkExpr(ek.operand, fn);
            break;
        case "AssignExpr":
            walkExpr(ek.target, fn);
            walkExpr(ek.value, fn);
            break;
        case "CallExpr":
            walkExpr(ek.callee, fn);
            ek.args.forEach((a) => walkExpr(a, fn));
            break;
        case "MemberExpr":
            walkExpr(ek.object, fn);
            break;
        case "IndexExpr":
            walkExpr(ek.object, fn);
            walkExpr(ek.index, fn);
            break;
        case "ArrayLit":
            ek.elements.forEach((e) => walkExpr(e, fn));
            break;
        case "MapLit":
            ek.entries.forEach((e) => { walkExpr(e.key, fn); walkExpr(e.value, fn); });
            break;
        case "StructLit":
            ek.fields.forEach((f) => walkExpr(f.value, fn));
            break;
        case "CastExpr":
            walkExpr(ek.expr, fn);
            fn(ek.targetType);
            break;
        case "RangeExpr":
            walkExpr(ek.start, fn);
            walkExpr(ek.end, fn);
            break;
        case "ParenExpr":
            walkExpr(ek.inner, fn);
            break;
        case "FlagSetExpr":
            walkExpr(ek.flagExpr, fn);
            walkExpr(ek.value, fn);
            break;
    }
}
//# sourceMappingURL=nodes.js.map