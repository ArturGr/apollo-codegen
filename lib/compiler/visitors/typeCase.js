"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const util_1 = require("util");
const collectAndMergeFields_1 = require("./collectAndMergeFields");
class Variant {
    constructor(possibleTypes, selections = [], fragmentSpreads = []) {
        this.possibleTypes = possibleTypes;
        this.selections = selections;
        this.fragmentSpreads = fragmentSpreads;
    }
    get fields() {
        return collectAndMergeFields_1.collectAndMergeFields(this);
    }
    inspect() {
        return `${util_1.inspect(this.possibleTypes)} -> ${util_1.inspect(collectAndMergeFields_1.collectAndMergeFields(this, false).map(field => field.responseKey))} ${util_1.inspect(this.fragmentSpreads.map(fragmentSpread => fragmentSpread.fragmentName))}\n`;
    }
}
exports.Variant = Variant;
function typeCaseForSelectionSet(selectionSet, mergeInFragmentSpreads = true) {
    const typeCase = new TypeCase(selectionSet.possibleTypes);
    for (const selection of selectionSet.selections) {
        switch (selection.kind) {
            case 'Field':
                for (const variant of typeCase.disjointVariantsFor(selectionSet.possibleTypes)) {
                    variant.selections.push(selection);
                }
                break;
            case 'FragmentSpread':
                if (typeCase.default.fragmentSpreads.some(fragmentSpread => fragmentSpread.fragmentName === selection.fragmentName))
                    continue;
                for (const variant of typeCase.disjointVariantsFor(selectionSet.possibleTypes)) {
                    variant.fragmentSpreads.push(selection);
                    if (!mergeInFragmentSpreads) {
                        variant.selections.push(selection);
                    }
                }
                if (mergeInFragmentSpreads) {
                    typeCase.merge(typeCaseForSelectionSet({
                        possibleTypes: selectionSet.possibleTypes.filter(type => selection.selectionSet.possibleTypes.includes(type)),
                        selections: selection.selectionSet.selections
                    }, mergeInFragmentSpreads));
                }
                break;
            case 'TypeCondition':
                typeCase.merge(typeCaseForSelectionSet({
                    possibleTypes: selectionSet.possibleTypes.filter(type => selection.selectionSet.possibleTypes.includes(type)),
                    selections: selection.selectionSet.selections
                }, mergeInFragmentSpreads));
                break;
            case 'BooleanCondition':
                typeCase.merge(typeCaseForSelectionSet(selection.selectionSet, mergeInFragmentSpreads), selectionSet => [
                    Object.assign({}, selection, { selectionSet })
                ]);
                break;
        }
    }
    return typeCase;
}
exports.typeCaseForSelectionSet = typeCaseForSelectionSet;
class TypeCase {
    get variants() {
        return Array.from(new Set(this.variantsByType.values()));
    }
    get defaultAndVariants() {
        return [this.default, ...this.variants];
    }
    get remainder() {
        if (this.default.possibleTypes.some(type => !this.variantsByType.has(type))) {
            return new Variant(this.default.possibleTypes.filter(type => !this.variantsByType.has(type)), this.default.selections, this.default.fragmentSpreads);
        }
        else {
            return undefined;
        }
    }
    get exhaustiveVariants() {
        const remainder = this.remainder;
        if (remainder) {
            return [remainder, ...this.variants];
        }
        else {
            return this.variants;
        }
    }
    constructor(possibleTypes) {
        this.default = new Variant(possibleTypes);
        this.variantsByType = new Map();
    }
    disjointVariantsFor(possibleTypes) {
        const variants = [];
        const matchesDefault = this.default.possibleTypes.every(type => possibleTypes.includes(type));
        if (matchesDefault) {
            variants.push(this.default);
        }
        const splits = new Map();
        for (const type of possibleTypes) {
            let original = this.variantsByType.get(type);
            if (!original) {
                if (matchesDefault)
                    continue;
                original = this.default;
            }
            let split = splits.get(original);
            if (!split) {
                split = new Variant([], [...original.selections], [...original.fragmentSpreads]);
                splits.set(original, split);
                variants.push(split);
            }
            if (original !== this.default) {
                original.possibleTypes.splice(original.possibleTypes.indexOf(type), 1);
            }
            this.variantsByType.set(type, split);
            split.possibleTypes.push(type);
        }
        return variants;
    }
    merge(otherTypeCase, transform) {
        for (const otherVariant of otherTypeCase.defaultAndVariants) {
            if (otherVariant.selections.length < 1)
                continue;
            for (const variant of this.disjointVariantsFor(otherVariant.possibleTypes)) {
                if (otherVariant.fragmentSpreads.length > 0) {
                    variant.fragmentSpreads = [...variant.fragmentSpreads, ...otherVariant.fragmentSpreads].filter((a, index, array) => array.findIndex(b => b.fragmentName == a.fragmentName) == index);
                }
                variant.selections.push(...(transform ? transform(otherVariant) : otherVariant.selections));
            }
        }
    }
    inspect() {
        return (`TypeCase\n` +
            `  default -> ${util_1.inspect(this.default)}\n` +
            this.variants.map(variant => `  ${util_1.inspect(variant)}\n`).join(''));
    }
}
exports.TypeCase = TypeCase;
//# sourceMappingURL=typeCase.js.map