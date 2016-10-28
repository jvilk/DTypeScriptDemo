interface Function {
  __rtti__: ts.RuntimeObjectType;
  __a__: typeof Function.prototype.apply;
}

declare function installGlobalTypes(): void;

installGlobalTypes();

namespace RuntimeTypes {
  import TypeTag = ts.TypeTag;
  import RuntimeSignature = ts.RuntimeSignature;
  import RuntimeType = ts.RuntimeType;
  import RuntimeObjectType = ts.RuntimeObjectType;
  import RuntimeProperty = ts.RuntimeProperty;
  let judgmentCache = new Map<string, boolean>();
  let nextId = 0;

  function checkRegistration(s: ts.RuntimeIDBase) {
    s.id < 0 ? s.id = nextId++ : 0;
  }

  function hasProperty(prop: string, val: Object | Function): boolean {
    if (!val) {
      return false
    } else if (val.hasOwnProperty(prop)) {
      return true;
    } else {
      return hasProperty(prop, Object.getPrototypeOf(val));
    }
  }

  function hasCompatibleProperty(t: RuntimeObjectType, prop: RuntimeProperty): boolean {
    const tProp = t.properties[prop.name];
    if (prop.optional && !tProp) {
      return true;
    } else if (tProp.optional && !prop.optional) {
      // Object w/ an optional property cannot be assigned to type w/ non-optional property.
      return false;
    } else {
      return isCompatible(tProp.type, prop.type);
    }
  }

  function uncachedIsCompatible(t1: RuntimeType, t2: RuntimeType): boolean {
    if (t1.type === TypeTag.Void || t1.type === TypeTag.Any || t1.type === TypeTag.Null) {
      return true;
    }

    switch (t2.type) {
      case TypeTag.Any:
        // Everything is a subtype of any.
        return true;
      case TypeTag.Boolean:
        return t1.type === TypeTag.Boolean || t1.type === TypeTag.BooleanLiteral;
      case TypeTag.Numeric:
        return t1.type === TypeTag.Numeric || t1.type === TypeTag.NumericLiteral;
      case TypeTag.String:
        return t1.type === TypeTag.String || t1.type === TypeTag.StringLiteral;
      case TypeTag.NumericLiteral:
      case TypeTag.BooleanLiteral:
      case TypeTag.StringLiteral:
        return t1.type === t2.type && t1.value === t2.value;
      case TypeTag.Void:
      case TypeTag.Null:
        return (<number> t1.type) === t2.type;
      case TypeTag.Intersection:
        // t1 must be a subtype of every member of the intersection.
        return t2.members.reduce((result, member) => {
          return result && isCompatible(t1, member);
        }, true);
      case TypeTag.Union:
        // t1 must be a subtype of at least one member of the union.
        return t2.members.reduce((result, member) => {
          return result || isCompatible(t1, member);
        }, false);
      case TypeTag.TypeParameter:
        throw new Error('Unsupported.');
      case TypeTag.Never:
        return t1.type === TypeTag.Never;
      case TypeTag.ObjectType:
        switch (t1.type) {
          case TypeTag.Union:
            // All members must be a subtype of t2.
            return t1.members.reduce((result, member) => {
              return result && isCompatible(member, t2);
            }, true);
          case TypeTag.Intersection:
            // Every property and signature on t1 must be in at least one of the members
            // An *incompatible property* on *any* of the members results in typechecking failure.
            throw new Error("Unsupported right now.");
          case TypeTag.ObjectType:
            let result = true;
            // All properties must be compatible.
            for (let propName in t2.properties) {
              if (t2.properties.hasOwnProperty(propName)) {
                const prop = t2.properties[propName];
                result = result && hasCompatibleProperty(t1, prop);
              }
            }
            result = result && areAllSignaturesCompatibleOnTypes(t1, t2);
            if (t2.numericIndexType) {
              result = result && !!t1.numericIndexType && isCompatible(t1.numericIndexType, t2.numericIndexType);
            }
            if (t2.stringIndexType) {
              result = result && !!t1.stringIndexType && isCompatible(t1.stringIndexType, t2.stringIndexType);
            }
            return result;
          default:
            return false;
        }
    }
  }

  /**
   * Is t1 assignable to t2?
   */
  function isCompatible(t1: RuntimeType, t2: RuntimeType): boolean {
    if (t1 === t2) {
      return true;
    }
    checkRegistration(t1);
    checkRegistration(t2);
    const cachedResult = judgmentCache.get(`${t1.id}=${t2.id}`);
    if (cachedResult !== undefined) {
      return cachedResult;
    }
    const result = uncachedIsCompatible(t1, t2);
    judgmentCache.set(`${t1.id}=${t2.id}`, result);
    return result;
  }

  function uncachedAreSignaturesCompatible(x: RuntimeSignature, y: RuntimeSignature): boolean {
    // To check if x is assignable to y, we first look at the parameter list.
    // Each parameter in x must have a corresponding parameter in y with a compatible type.
    if (x.mandatoryArgs > y.mandatoryArgs) {
      // y does not supply enough arguments for x
      return false;
    }
    // Check each parameter. If a parameter is *optional*, then either y supplies it or doesn't.
    // If y supplies an incompatible optional argument, that is an error.
    let result = x.args.reduce((result, paramType, i) => {
      return result &&
        // y does not supply this parameter. The parameter must be optional due to previous
        // mandatory args check.
        (y.args.length >= i ||
        // When comparing the types of function parameters, assignment succeeds if either
        // the source parameter is assignable to the target parameter, or vice versa
         isCompatible(y.args[i], paramType) ||
         isCompatible(paramType, y.args[i]));
    }, true);
    if (x.varargs) {
      // When a function has a rest parameter, it is treated as if it were an infinite series of optional parameters.
      for (let i = x.args.length; i < y.args.length; i++) {
        const yArg = y.args[i];
        result = result && (isCompatible(yArg, x.varargs) || isCompatible(x.varargs, yArg));
      }
    }
    return result && isCompatible(y.result, x.result);
  }

  /**
   * Are these two signatures compatible? Can s1 be assigned to s2?
   */
  function areSignaturesCompatible(s1: RuntimeSignature, s2: RuntimeSignature): boolean {
    if (s1 === s2) {
      return true;
    }
    checkRegistration(s1);
    checkRegistration(s2);
    const cachedResult = judgmentCache.get(`${s1.id}=${s2.id}`);
    if (cachedResult !== undefined) {
      return cachedResult;
    }
    const result = uncachedAreSignaturesCompatible(s1, s2);
    judgmentCache.set(`${s1.id}=${s2.id}`, result);
    return result;
  }

  function uncachedAreAllSignaturesCompatible(s1: RuntimeSignature[], s2: RuntimeSignature[]): boolean {
    // O(n^2) check
    return s1.reduce((result, callSig) => {
      return s2.reduce((result, fCallSig) => {
        return result || areSignaturesCompatible(fCallSig, callSig);
      }, false);
    }, true);
  }

  /**
   * Are the call and construct signatures of Function and Type compatible?
   */
  function areAllSignaturesCompatibleOnFunction(f: Function, t: RuntimeObjectType): boolean {
    if (!f.__rtti__) {
      // Generic Function object.
      return true;
    }
    const ft = f.__rtti__;
    checkRegistration(t);
    const cachedResult = judgmentCache.get(`${ft.id}<${t.id}`);
    if (cachedResult !== undefined) {
      return cachedResult;
    }
    const result = uncachedAreAllSignaturesCompatible(ft.callSignatures, t.callSignatures) &&
                   uncachedAreAllSignaturesCompatible(ft.constructSignatures, t.constructSignatures);
    judgmentCache.set(`${ft.id}<${t.id}`, result);
    return result;
  }

  /**
   * Are the call and construct signatures of Type and Type compatible?
   * Uncacheable, as this is only part of a subtyping relationship.
   */
  function areAllSignaturesCompatibleOnTypes(t1: RuntimeObjectType, t2: RuntimeObjectType): boolean {
    const result = uncachedAreAllSignaturesCompatible(t1.callSignatures, t2.callSignatures) &&
                   uncachedAreAllSignaturesCompatible(t1.constructSignatures, t2.constructSignatures);
    return result;
  }

  function isType(value: any, type: RuntimeType): boolean {
    if (value === null || value === undefined) {
      return true;
    }
    switch (type.type) {
      case TypeTag.Never:
        return false;
      case TypeTag.Any:
        return true;
      case TypeTag.Boolean:
        return typeof(value) === 'boolean';
      case TypeTag.Numeric:
        return typeof(value) === 'number';
      case TypeTag.String:
        return typeof(value) === 'string';
      case TypeTag.NumericLiteral:
      case TypeTag.BooleanLiteral:
      case TypeTag.StringLiteral:
        return value === type.value;
      case TypeTag.Void:
        return value === undefined;
      case TypeTag.Null:
        return value === null;
      case TypeTag.Intersection:
        return type.members.reduce((result, member) => {
          return result && isType(value, member);
        }, true);
      case TypeTag.Union:
        return type.members.reduce((result, member) => {
          return result || isType(value, member);
        }, false);
      case TypeTag.TypeParameter:
        throw new Error('Unsupported.');
      case TypeTag.ObjectType:
        let isFunction = false;
        // Note: Covers objects *and* functions.
        // A function is just an ObjectType with call/construct signatures.
        switch (typeof(value)) {
          case 'object':
            // JS objects cannot be callable.
            if ((type.callSignatures.length + type.constructSignatures.length) > 0) {
              return false;
            }
            break;
          case 'function':
            isFunction = true;
            break;
          default:
            return false;
        }

        let result = true;
        for (let propName in type.properties) {
          if (type.properties.hasOwnProperty(propName)) {
            const prop = type.properties[propName];
            result = result && isType(value[prop.name], prop.type) && (prop.optional ? true : hasProperty(prop.name, value));
          }
        }
        if (isFunction) {
          result = result && areAllSignaturesCompatibleOnFunction(value, type);
        }

        if (type.numericIndexType && result) {
          if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
            // Check numeric index property!
            const numericIndexType = type.numericIndexType;
            switch (numericIndexType.type) {
              case TypeTag.Numeric:
                // Not a problem.
                break;
              case TypeTag.NumericLiteral:
                // Check if array matches literal.
                const arr = <Uint8Array> value;
                for (let i = 0; result && i < arr.length; i++) {
                  result = result && arr[i] === numericIndexType.value;
                }
                break;
              default:
                result = false;
                break;
            }
          }

          if (Array.isArray(value)) {
            // Check numeric index property!
            const numericIndexType = type.numericIndexType;
            for (let i = 0; result && i < value.length; i++) {
              result = result && isType(value[i], numericIndexType);
            }
          }
        }
        return result;
    }
  }

  function sigToString(s: RuntimeSignature): string {
    return `(${s.args.map(typeToString).join(', ')}${s.varargs ? `, ...${typeToString(s.varargs)}[]` : ''}) => ${typeToString(s.result)};`;
  }

  function typeToString(t: RuntimeType): string {
    switch (t.type) {
      case TypeTag.Any:
        return 'any';
      case TypeTag.Never:
        return 'never';
      case TypeTag.Boolean:
        return 'boolean';
      case TypeTag.Numeric:
        return 'number';
      case TypeTag.String:
        return 'string';
      case TypeTag.NumericLiteral:
      case TypeTag.BooleanLiteral:
        return `${t.value}`;
      case TypeTag.StringLiteral:
        return `'${t.value}'`
      case TypeTag.Void:
        return `undefined`;
      case TypeTag.Null:
        return 'null';
      case TypeTag.Intersection:
        if (t.name) {
          return t.name;
        }
        return `(${t.members.map(typeToString).join(" & ")})`;
      case TypeTag.Union:
        if (t.name) {
          return t.name;
        }
        return `(${t.members.map(typeToString).join(" | ")})`;
      case TypeTag.TypeParameter:
        throw new Error('Unsupported.');
      case TypeTag.ObjectType:
        if (t.name) {
          return t.name;
        }
        let rv = '{\n';

        if (t.numericIndexType) {
          rv += `  [number]: ${typeToString(t.numericIndexType)};\n`;
        }
        if (t.stringIndexType) {
          rv += `  [string]: ${typeToString(t.stringIndexType)};\n`;
        }
        if (t.callSignatures.length > 0) {
          rv += `  ${t.callSignatures.map(sigToString).join("\n  ")}\n`;
        }
        if (t.constructSignatures.length > 0) {
          rv += `  ${t.constructSignatures.map((sig) => `new ${sigToString(sig)}`).join("\n  ")}\n`;
        }

        for (let propName in t.properties) {
          if (t.properties.hasOwnProperty(propName)) {
            const prop = t.properties[propName];
            rv += `  "${prop.name}": ${typeToString(prop.type)},\n`
          }
        }
        return rv + '}';
    }
  }

  function valueToString(value: any, indent: string = '', seen = new Set<Object>()): string {
    if (value === null) {
      return `null`;
    }
    switch (typeof(value)) {
      case 'undefined':
        return `undefined`;
      case 'boolean':
        return `${value}`;
      case 'string':
        return `'${value}'`;
      case 'function':
        let f: Function = value;
        if (f.__rtti__) {
          return typeToString(f.__rtti__);
        } else {
          return `Function`;
        }
      case 'object':
        if (seen.has(value)) {
          return '[circular reference]';
        }
        seen.add(value);
        if (Array.isArray(value)) {
          let rv = '[';
          for (let i = 0; i < 10 && value.length; i++) {
            rv += `${valueToString(value[i], indent, seen)}${i === value.length - 1 ? '' : ', '}`;
          }
          if (value.length > 10) {
            rv += "...";
          }
          rv += ']';
          return rv;
        } else {
          let rv = '{\n';
          for (let propName in value) {
            rv += `${indent}  ${propName}: ${valueToString(value[propName], indent + '  ', seen)},\n`
          }
          rv += `${indent}}`;
          return rv;
        }
      default:
        throw new Error(`Unexpected typeof value: ${typeof(value)}`);
    }
  }

  export function assertType(value: any, type: RuntimeType, file: string, line: number, col: number): any {
    if (!isType(value, type)) {
      const msg = `Value:\n${valueToString}\nis not assignable to type:\n${typeToString(type)}`;
      RuntimeTypes.notifyTypeError(msg, file, line, col);
      debugger;
      throw new Error(`${file}:${line}:${col} ${msg}`);
    }
    return value;
  }

  export function registerType(t: RuntimeObjectType, f: Function): Function {
    f.__rtti__ = t;
    checkRegistration(t);
    return f;
  }

  export let notifyTypeError: (msg: string, file: string, line: number, col: number) => void = () => {};

  function checkIfValuesMatchSignature(sig: RuntimeSignature, args: any[]): boolean {
    // Each argument must be compatible with sig's arguments.
    if (args.length < sig.mandatoryArgs) {
      // Not enough arguments supplied.
      return false;
    }
    let result = true;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      const sigArg = i < sig.args.length ? sig.args[i] : sig.varargs ? sig.varargs : null;
      if (sigArg === null) {
        // OK to call function with extra arguments that are dropped.
        return true;
      }
      result = result && isType(arg, sigArg);
    }
    return result;
  }

  const savedApply = Function.prototype.apply;

  Function.prototype.apply = function(this: Function, thisObj: any, args: any[]): any {
    if (this.__rtti__) {
      // Check if any of the signatures match.
      let result = this.__rtti__.callSignatures.reduce((result: boolean, sig: RuntimeSignature) => {
        return result || checkIfValuesMatchSignature(sig, args);
      }, false);
      if (!result) {
        const msg = `Function:\n${typeToString(this.__rtti__)}\nis not callable with arguments:\n[${args.map((val) => valueToString(val)).join(", ")}]`;
        RuntimeTypes.notifyTypeError(msg, "", 0, 0);
        debugger;
        throw new Error(`${msg}`);
      }
    }

    this.__a__ = savedApply;
    try {
      const rv = this.__a__(thisObj, args);
      return rv;
    } finally {
      this.__a__ = undefined;
    }
  };

  Function.prototype.call = function(this: Function, thisObj: any, ...args: any[]): any {
    this.apply(thisObj, args);
  }
}
