"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const graphql_1 = require("graphql");
const printing_1 = require("../utilities/printing");
const language_1 = require("./language");
const helpers_1 = require("./helpers");
const graphql_2 = require("../utilities/graphql");
const typeCase_1 = require("../compiler/visitors/typeCase");
const collectFragmentsReferenced_1 = require("../compiler/visitors/collectFragmentsReferenced");
const generateOperationId_1 = require("../compiler/visitors/generateOperationId");
const collectAndMergeFields_1 = require("../compiler/visitors/collectAndMergeFields");
require("../utilities/array");
function generateSource(context, outputIndividualFiles, only) {
    const generator = new SwiftAPIGenerator(context);
    if (outputIndividualFiles) {
        generator.withinFile(`Types.graphql.swift`, () => {
            generator.fileHeader();
            generator.namespaceDeclaration(context.options.namespace, () => {
                context.typesUsed.forEach(type => {
                    generator.typeDeclarationForGraphQLType(type);
                });
            });
        });
        const inputFilePaths = new Set();
        Object.values(context.operations).forEach(operation => {
            inputFilePaths.add(operation.filePath);
        });
        Object.values(context.fragments).forEach(fragment => {
            inputFilePaths.add(fragment.filePath);
        });
        for (const inputFilePath of inputFilePaths) {
            if (only && inputFilePath !== only)
                continue;
            generator.withinFile(`${path.basename(inputFilePath)}.swift`, () => {
                generator.fileHeader();
                generator.namespaceExtensionDeclaration(context.options.namespace, () => {
                    Object.values(context.operations).forEach(operation => {
                        if (operation.filePath === inputFilePath) {
                            generator.classDeclarationForOperation(operation);
                        }
                    });
                    Object.values(context.fragments).forEach(fragment => {
                        if (fragment.filePath === inputFilePath) {
                            generator.structDeclarationForFragment(fragment);
                        }
                    });
                });
            });
        }
    }
    else {
        generator.fileHeader();
        generator.namespaceDeclaration(context.options.namespace, () => {
            context.typesUsed.forEach(type => {
                generator.typeDeclarationForGraphQLType(type);
            });
            Object.values(context.operations).forEach(operation => {
                generator.classDeclarationForOperation(operation);
            });
            Object.values(context.fragments).forEach(fragment => {
                generator.structDeclarationForFragment(fragment);
            });
        });
    }
    return generator;
}
exports.generateSource = generateSource;
class SwiftAPIGenerator extends language_1.SwiftGenerator {
    constructor(context) {
        super(context);
        this.helpers = new helpers_1.Helpers(context.options);
    }
    fileHeader() {
        this.printOnNewline('//  This file was automatically generated and should not be edited.');
        this.printNewline();
        this.printOnNewline('import Apollo');
    }
    classDeclarationForOperation(operation) {
        const { operationName, operationType, variables, source, selectionSet } = operation;
        let className;
        let protocol;
        switch (operationType) {
            case 'query':
                className = `${this.helpers.operationClassName(operationName)}Query`;
                protocol = 'GraphQLQuery';
                break;
            case 'mutation':
                className = `${this.helpers.operationClassName(operationName)}Mutation`;
                protocol = 'GraphQLMutation';
                break;
            case 'subscription':
                className = `${this.helpers.operationClassName(operationName)}Subscription`;
                protocol = 'GraphQLSubscription';
                break;
            default:
                throw new graphql_1.GraphQLError(`Unsupported operation type "${operationType}"`);
        }
        this.classDeclaration({
            className,
            modifiers: ['public', 'final'],
            adoptedProtocols: [protocol]
        }, () => {
            if (source) {
                this.printOnNewline('public let operationDefinition =');
                this.withIndent(() => {
                    this.multilineString(source);
                });
            }
            const fragmentsReferenced = collectFragmentsReferenced_1.collectFragmentsReferenced(operation.selectionSet, this.context.fragments);
            if (this.context.options.generateOperationIds) {
                const { operationId } = generateOperationId_1.generateOperationId(operation, this.context.fragments, fragmentsReferenced);
                operation.operationId = operationId;
                this.printNewlineIfNeeded();
                this.printOnNewline(`public let operationIdentifier: String? = "${operationId}"`);
            }
            if (fragmentsReferenced.size > 0) {
                this.printNewlineIfNeeded();
                this.printOnNewline('public var queryDocument: String { return operationDefinition');
                fragmentsReferenced.forEach(fragmentName => {
                    this.print(`.appending(${this.helpers.structNameForFragmentName(fragmentName)}.fragmentDefinition)`);
                });
                this.print(' }');
            }
            this.printNewlineIfNeeded();
            if (variables && variables.length > 0) {
                const properties = variables.map(({ name, type }) => {
                    const typeName = this.helpers.typeNameFromGraphQLType(type);
                    const isOptional = !(type instanceof graphql_1.GraphQLNonNull ||
                        (type instanceof graphql_1.GraphQLList && type.ofType instanceof graphql_1.GraphQLNonNull));
                    return { name, propertyName: name, type, typeName, isOptional };
                });
                this.propertyDeclarations(properties);
                this.printNewlineIfNeeded();
                this.initializerDeclarationForProperties(properties);
                this.printNewlineIfNeeded();
                this.printOnNewline(`public var variables: GraphQLMap?`);
                this.withinBlock(() => {
                    this.printOnNewline(printing_1.wrap(`return [`, printing_1.join(properties.map(({ name, propertyName }) => `"${name}": ${language_1.escapeIdentifierIfNeeded(propertyName)}`), ', ') || ':', `]`));
                });
            }
            else {
                this.initializerDeclarationForProperties([]);
            }
            this.structDeclarationForSelectionSet({
                structName: 'Data',
                selectionSet
            });
        });
    }
    structDeclarationForFragment({ fragmentName, selectionSet, source }) {
        const structName = this.helpers.structNameForFragmentName(fragmentName);
        this.structDeclarationForSelectionSet({
            structName,
            adoptedProtocols: ['GraphQLFragment'],
            selectionSet
        }, () => {
            if (source) {
                this.printOnNewline('public static let fragmentDefinition =');
                this.withIndent(() => {
                    this.multilineString(source);
                });
            }
        });
    }
    structDeclarationForSelectionSet({ structName, adoptedProtocols = ['GraphQLSelectionSet'], selectionSet }, before) {
        const typeCase = typeCase_1.typeCaseForSelectionSet(selectionSet, this.context.options.mergeInFieldsFromFragmentSpreads);
        this.structDeclarationForVariant({
            structName,
            adoptedProtocols,
            variant: typeCase.default,
            typeCase
        }, before, () => {
            const variants = typeCase.variants.map(this.helpers.propertyFromVariant, this.helpers);
            for (const variant of variants) {
                this.propertyDeclarationForVariant(variant);
                this.structDeclarationForVariant({
                    structName: variant.structName,
                    variant
                });
            }
        });
    }
    structDeclarationForVariant({ structName, adoptedProtocols = ['GraphQLSelectionSet'], variant, typeCase }, before, after) {
        this.structDeclaration({ structName, adoptedProtocols }, () => {
            if (before) {
                before();
            }
            this.printNewlineIfNeeded();
            this.printOnNewline('public static let possibleTypes = [');
            this.print(printing_1.join(variant.possibleTypes.map(type => `"${type.name}"`), ', '));
            this.print(']');
            this.printNewlineIfNeeded();
            this.printOnNewline('public static let selections: [GraphQLSelection] = ');
            if (typeCase) {
                this.typeCaseInitialization(typeCase);
            }
            else {
                this.selectionSetInitialization(variant);
            }
            this.printNewlineIfNeeded();
            this.printOnNewline(`public private(set) var resultMap: ResultMap`);
            this.printNewlineIfNeeded();
            this.printOnNewline('public init(unsafeResultMap: ResultMap)');
            this.withinBlock(() => {
                this.printOnNewline(`self.resultMap = unsafeResultMap`);
            });
            if (typeCase) {
                this.initializersForTypeCase(typeCase);
            }
            else {
                this.initializersForVariant(variant);
            }
            const fields = collectAndMergeFields_1.collectAndMergeFields(variant, this.context.options.mergeInFieldsFromFragmentSpreads).map(field => this.helpers.propertyFromField(field));
            const fragmentSpreads = variant.fragmentSpreads.map(fragmentSpread => {
                const isConditional = variant.possibleTypes.some(type => !fragmentSpread.selectionSet.possibleTypes.includes(type));
                return this.helpers.propertyFromFragmentSpread(fragmentSpread, isConditional);
            });
            fields.forEach(this.propertyDeclarationForField, this);
            if (fragmentSpreads.length > 0) {
                this.printNewlineIfNeeded();
                this.printOnNewline(`public var fragments: Fragments`);
                this.withinBlock(() => {
                    this.printOnNewline('get');
                    this.withinBlock(() => {
                        this.printOnNewline(`return Fragments(unsafeResultMap: resultMap)`);
                    });
                    this.printOnNewline('set');
                    this.withinBlock(() => {
                        this.printOnNewline(`resultMap += newValue.resultMap`);
                    });
                });
                this.structDeclaration({
                    structName: 'Fragments'
                }, () => {
                    this.printOnNewline(`public private(set) var resultMap: ResultMap`);
                    this.printNewlineIfNeeded();
                    this.printOnNewline('public init(unsafeResultMap: ResultMap)');
                    this.withinBlock(() => {
                        this.printOnNewline(`self.resultMap = unsafeResultMap`);
                    });
                    for (const fragmentSpread of fragmentSpreads) {
                        const { propertyName, typeName, structName, isConditional } = fragmentSpread;
                        this.printNewlineIfNeeded();
                        this.printOnNewline(`public var ${language_1.escapeIdentifierIfNeeded(propertyName)}: ${typeName}`);
                        this.withinBlock(() => {
                            this.printOnNewline('get');
                            this.withinBlock(() => {
                                if (isConditional) {
                                    this.printOnNewline(`if !${structName}.possibleTypes.contains(resultMap["__typename"]! as! String) { return nil }`);
                                }
                                this.printOnNewline(`return ${structName}(unsafeResultMap: resultMap)`);
                            });
                            this.printOnNewline('set');
                            this.withinBlock(() => {
                                if (isConditional) {
                                    this.printOnNewline(`guard let newValue = newValue else { return }`);
                                    this.printOnNewline(`resultMap += newValue.resultMap`);
                                }
                                else {
                                    this.printOnNewline(`resultMap += newValue.resultMap`);
                                }
                            });
                        });
                    }
                });
            }
            for (const field of fields) {
                if (graphql_1.isCompositeType(graphql_1.getNamedType(field.type)) && field.selectionSet) {
                    this.structDeclarationForSelectionSet({
                        structName: field.structName,
                        selectionSet: field.selectionSet
                    });
                }
            }
            if (after) {
                after();
            }
        });
    }
    initializersForTypeCase(typeCase) {
        const variants = typeCase.variants;
        if (variants.length == 0) {
            this.initializersForVariant(typeCase.default);
        }
        else {
            const remainder = typeCase.remainder;
            for (const variant of remainder ? [remainder, ...variants] : variants) {
                this.initializersForVariant(variant, variant === remainder ? undefined : this.helpers.structNameForVariant(variant), false);
            }
        }
    }
    initializersForVariant(variant, namespace, useInitializerIfPossible = true) {
        if (useInitializerIfPossible && variant.possibleTypes.length == 1) {
            const properties = this.helpers.propertiesForSelectionSet(variant);
            if (!properties)
                return;
            this.printNewlineIfNeeded();
            this.printOnNewline(`public init`);
            this.parametersForProperties(properties);
            this.withinBlock(() => {
                this.printOnNewline(printing_1.wrap(`self.init(unsafeResultMap: [`, printing_1.join([
                    `"__typename": "${variant.possibleTypes[0]}"`,
                    ...properties.map(this.propertyAssignmentForField, this)
                ], ', ') || ':', `])`));
            });
        }
        else {
            const structName = this.scope.typeName;
            for (const possibleType of variant.possibleTypes) {
                const properties = this.helpers.propertiesForSelectionSet({
                    possibleTypes: [possibleType],
                    selections: variant.selections
                }, namespace);
                if (!properties)
                    continue;
                this.printNewlineIfNeeded();
                this.printOnNewline(`public static func make${possibleType}`);
                this.parametersForProperties(properties);
                this.print(` -> ${structName}`);
                this.withinBlock(() => {
                    this.printOnNewline(printing_1.wrap(`return ${structName}(unsafeResultMap: [`, printing_1.join([`"__typename": "${possibleType}"`, ...properties.map(this.propertyAssignmentForField, this)], ', ') || ':', `])`));
                });
            }
        }
    }
    propertyAssignmentForField(field) {
        const { responseKey, propertyName, type, isConditional, structName } = field;
        const valueExpression = graphql_1.isCompositeType(graphql_1.getNamedType(type))
            ? this.helpers.mapExpressionForType(type, isConditional, expression => `${expression}.resultMap`, language_1.escapeIdentifierIfNeeded(propertyName), structName, 'ResultMap')
            : language_1.escapeIdentifierIfNeeded(propertyName);
        return `"${responseKey}": ${valueExpression}`;
    }
    propertyDeclarationForField(field) {
        const { responseKey, propertyName, typeName, type, isOptional, isConditional } = field;
        const unmodifiedFieldType = graphql_1.getNamedType(type);
        this.printNewlineIfNeeded();
        this.comment(field.description);
        this.deprecationAttributes(field.isDeprecated, field.deprecationReason);
        this.printOnNewline(`public var ${language_1.escapeIdentifierIfNeeded(propertyName)}: ${typeName}`);
        this.withinBlock(() => {
            if (graphql_1.isCompositeType(unmodifiedFieldType)) {
                const structName = language_1.escapeIdentifierIfNeeded(this.helpers.structNameForPropertyName(propertyName));
                if (graphql_2.isList(type)) {
                    this.printOnNewline('get');
                    this.withinBlock(() => {
                        const resultMapTypeName = this.helpers.typeNameFromGraphQLType(type, 'ResultMap', false);
                        let expression;
                        if (isOptional) {
                            expression = `(resultMap["${responseKey}"] as? ${resultMapTypeName})`;
                        }
                        else {
                            expression = `(resultMap["${responseKey}"] as! ${resultMapTypeName})`;
                        }
                        this.printOnNewline(`return ${this.helpers.mapExpressionForType(type, isConditional, expression => `${structName}(unsafeResultMap: ${expression})`, expression, 'ResultMap', structName)}`);
                    });
                    this.printOnNewline('set');
                    this.withinBlock(() => {
                        let newValueExpression = this.helpers.mapExpressionForType(type, isConditional, expression => `${expression}.resultMap`, 'newValue', structName, 'ResultMap');
                        this.printOnNewline(`resultMap.updateValue(${newValueExpression}, forKey: "${responseKey}")`);
                    });
                }
                else {
                    this.printOnNewline('get');
                    this.withinBlock(() => {
                        if (isOptional) {
                            this.printOnNewline(`return (resultMap["${responseKey}"] as? ResultMap).flatMap { ${structName}(unsafeResultMap: $0) }`);
                        }
                        else {
                            this.printOnNewline(`return ${structName}(unsafeResultMap: resultMap["${responseKey}"]! as! ResultMap)`);
                        }
                    });
                    this.printOnNewline('set');
                    this.withinBlock(() => {
                        let newValueExpression;
                        if (isOptional) {
                            newValueExpression = 'newValue?.resultMap';
                        }
                        else {
                            newValueExpression = 'newValue.resultMap';
                        }
                        this.printOnNewline(`resultMap.updateValue(${newValueExpression}, forKey: "${responseKey}")`);
                    });
                }
            }
            else {
                this.printOnNewline('get');
                this.withinBlock(() => {
                    if (isOptional) {
                        this.printOnNewline(`return resultMap["${responseKey}"] as? ${typeName.slice(0, -1)}`);
                    }
                    else {
                        this.printOnNewline(`return resultMap["${responseKey}"]! as! ${typeName}`);
                    }
                });
                this.printOnNewline('set');
                this.withinBlock(() => {
                    this.printOnNewline(`resultMap.updateValue(newValue, forKey: "${responseKey}")`);
                });
            }
        });
    }
    propertyDeclarationForVariant(variant) {
        const { propertyName, typeName, structName } = variant;
        this.printNewlineIfNeeded();
        this.printOnNewline(`public var ${language_1.escapeIdentifierIfNeeded(propertyName)}: ${typeName}`);
        this.withinBlock(() => {
            this.printOnNewline('get');
            this.withinBlock(() => {
                this.printOnNewline(`if !${structName}.possibleTypes.contains(__typename) { return nil }`);
                this.printOnNewline(`return ${structName}(unsafeResultMap: resultMap)`);
            });
            this.printOnNewline('set');
            this.withinBlock(() => {
                this.printOnNewline(`guard let newValue = newValue else { return }`);
                this.printOnNewline(`resultMap = newValue.resultMap`);
            });
        });
    }
    initializerDeclarationForProperties(properties) {
        this.printOnNewline(`public init`);
        this.parametersForProperties(properties);
        this.withinBlock(() => {
            properties.forEach(({ propertyName }) => {
                this.printOnNewline(`self.${propertyName} = ${language_1.escapeIdentifierIfNeeded(propertyName)}`);
            });
        });
    }
    parametersForProperties(properties) {
        this.print('(');
        this.print(printing_1.join(properties.map(({ propertyName, typeName, isOptional }) => printing_1.join([`${language_1.escapeIdentifierIfNeeded(propertyName)}: ${typeName}`, isOptional && ' = nil'])), ', '));
        this.print(')');
    }
    typeCaseInitialization(typeCase) {
        if (typeCase.variants.length < 1) {
            this.selectionSetInitialization(typeCase.default);
            return;
        }
        this.print('[');
        this.withIndent(() => {
            this.printOnNewline(`GraphQLTypeCase(`);
            this.withIndent(() => {
                this.printOnNewline(`variants: [`);
                this.print(typeCase.variants
                    .flatMap(variant => {
                    const structName = this.helpers.structNameForVariant(variant);
                    return variant.possibleTypes.map(type => `"${type}": ${structName}.selections`);
                })
                    .join(', '));
                this.print('],');
                this.printOnNewline(`default: `);
                this.selectionSetInitialization(typeCase.default);
            });
            this.printOnNewline(')');
        });
        this.printOnNewline(']');
    }
    selectionSetInitialization(selectionSet) {
        this.print('[');
        this.withIndent(() => {
            for (const selection of selectionSet.selections) {
                switch (selection.kind) {
                    case 'Field': {
                        const { name, alias, args, type } = selection;
                        const responseKey = selection.alias || selection.name;
                        const structName = this.helpers.structNameForPropertyName(responseKey);
                        this.printOnNewline(`GraphQLField(`);
                        this.print(printing_1.join([
                            `"${name}"`,
                            alias ? `alias: "${alias}"` : null,
                            args &&
                                args.length &&
                                `arguments: ${this.helpers.dictionaryLiteralForFieldArguments(args)}`,
                            `type: ${this.helpers.fieldTypeEnum(type, structName)}`
                        ], ', '));
                        this.print('),');
                        break;
                    }
                    case 'BooleanCondition':
                        this.printOnNewline(`GraphQLBooleanCondition(`);
                        this.print(printing_1.join([
                            `variableName: "${selection.variableName}"`,
                            `inverted: ${selection.inverted}`,
                            'selections: '
                        ], ', '));
                        this.selectionSetInitialization(selection.selectionSet);
                        this.print('),');
                        break;
                    case 'TypeCondition': {
                        this.printOnNewline(`GraphQLTypeCondition(`);
                        this.print(printing_1.join([
                            `possibleTypes: [${printing_1.join(selection.selectionSet.possibleTypes.map(type => `"${type.name}"`), ', ')}]`,
                            'selections: '
                        ], ', '));
                        this.selectionSetInitialization(selection.selectionSet);
                        this.print('),');
                        break;
                    }
                    case 'FragmentSpread': {
                        const structName = this.helpers.structNameForFragmentName(selection.fragmentName);
                        this.printOnNewline(`GraphQLFragmentSpread(${structName}.self),`);
                        break;
                    }
                }
            }
        });
        this.printOnNewline(']');
    }
    typeDeclarationForGraphQLType(type) {
        if (type instanceof graphql_1.GraphQLEnumType) {
            this.enumerationDeclaration(type);
        }
        else if (type instanceof graphql_1.GraphQLInputObjectType) {
            this.structDeclarationForInputObjectType(type);
        }
    }
    enumerationDeclaration(type) {
        const { name, description } = type;
        const values = type.getValues();
        this.printNewlineIfNeeded();
        this.comment(description);
        this.printOnNewline(`public enum ${name}: RawRepresentable, Equatable, Apollo.JSONDecodable, Apollo.JSONEncodable`);
        this.withinBlock(() => {
            this.printOnNewline('public typealias RawValue = String');
            values.forEach(value => {
                this.comment(value.description);
                this.deprecationAttributes(value.isDeprecated, value.deprecationReason);
                this.printOnNewline(`case ${language_1.escapeIdentifierIfNeeded(this.helpers.enumCaseName(value.name))}`);
            });
            this.comment('Auto generated constant for unknown enum values');
            this.printOnNewline('case __unknown(RawValue)');
            this.printNewlineIfNeeded();
            this.printOnNewline('public init?(rawValue: RawValue)');
            this.withinBlock(() => {
                this.printOnNewline('switch rawValue');
                this.withinBlock(() => {
                    values.forEach(value => {
                        this.printOnNewline(`case "${value.value}": self = ${language_1.escapeIdentifierIfNeeded(this.helpers.enumDotCaseName(value.name))}`);
                    });
                    this.printOnNewline(`default: self = .__unknown(rawValue)`);
                });
            });
            this.printNewlineIfNeeded();
            this.printOnNewline('public var rawValue: RawValue');
            this.withinBlock(() => {
                this.printOnNewline('switch self');
                this.withinBlock(() => {
                    values.forEach(value => {
                        this.printOnNewline(`case ${language_1.escapeIdentifierIfNeeded(this.helpers.enumDotCaseName(value.name))}: return "${value.value}"`);
                    });
                    this.printOnNewline(`case .__unknown(let value): return value`);
                });
            });
            this.printNewlineIfNeeded();
            this.printOnNewline(`public static func == (lhs: ${name}, rhs: ${name}) -> Bool`);
            this.withinBlock(() => {
                this.printOnNewline('switch (lhs, rhs)');
                this.withinBlock(() => {
                    values.forEach(value => {
                        const enumDotCaseName = language_1.escapeIdentifierIfNeeded(this.helpers.enumDotCaseName(value.name));
                        const tuple = `(${enumDotCaseName}, ${enumDotCaseName})`;
                        this.printOnNewline(`case ${tuple}: return true`);
                    });
                    this.printOnNewline(`case (.__unknown(let lhsValue), .__unknown(let rhsValue)): return lhsValue == rhsValue`);
                    this.printOnNewline(`default: return false`);
                });
            });
        });
    }
    structDeclarationForInputObjectType(type) {
        const { name: structName, description } = type;
        const adoptedProtocols = ['GraphQLMapConvertible'];
        const fields = Object.values(type.getFields());
        const properties = fields.map(this.helpers.propertyFromInputField, this.helpers);
        properties.forEach(property => {
            if (property.isOptional) {
                property.typeName = `Swift.Optional<${property.typeName}>`;
            }
        });
        this.structDeclaration({ structName, description, adoptedProtocols }, () => {
            this.printOnNewline(`public var graphQLMap: GraphQLMap`);
            this.printNewlineIfNeeded();
            this.printOnNewline(`public init`);
            this.print('(');
            this.print(printing_1.join(properties.map(({ propertyName, typeName, isOptional }) => printing_1.join([`${language_1.escapeIdentifierIfNeeded(propertyName)}: ${typeName}`, isOptional && ' = nil'])), ', '));
            this.print(')');
            this.withinBlock(() => {
                this.printOnNewline(printing_1.wrap(`graphQLMap = [`, printing_1.join(properties.map(({ name, propertyName }) => `"${name}": ${language_1.escapeIdentifierIfNeeded(propertyName)}`), ', ') || ':', `]`));
            });
            for (const { name, propertyName, typeName, description } of properties) {
                this.printNewlineIfNeeded();
                this.comment(description);
                this.printOnNewline(`public var ${language_1.escapeIdentifierIfNeeded(propertyName)}: ${typeName}`);
                this.withinBlock(() => {
                    this.printOnNewline('get');
                    this.withinBlock(() => {
                        this.printOnNewline(`return graphQLMap["${name}"] as! ${typeName}`);
                    });
                    this.printOnNewline('set');
                    this.withinBlock(() => {
                        this.printOnNewline(`graphQLMap.updateValue(newValue, forKey: "${name}")`);
                    });
                });
            }
        });
    }
}
exports.SwiftAPIGenerator = SwiftAPIGenerator;
//# sourceMappingURL=codeGeneration.js.map