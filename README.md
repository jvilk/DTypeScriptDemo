# DTypeScript Demo

**Note: This is a class project for a PL seminar class, and is not intended for production use.**

To build:

`npm install`

To run:

`npm start`

Visit `https://localhost:8080/` for the demo.

## Technical Details

Our implementation performs static type checking at runtime for the following TypeScript operations:

* Downcasts
* `Function.call` / `Function.apply`
* `new Function (arg1, arg2, ..., returnType, body)`
* `setTimeout/setInterval(text, timeout)`
* `eval()`

Note that DTypeScript's type system is unsound in the same manner as TypeScript.

DTypeScript does not check the following items:

* Upcasts from `any`
* Correctness of functional bivariance
* Other areas where the TypeScript type system is explicitly unsound

### Typechecking Values

DTypeScript can use JavaScript reflection to determine the structural type of most JavaScript values.

### Function Signatures

DTypeScript is unable to reconstruct function type signatures using JavaScript introspection.
In order to typecheck function signatures, DTypeScript injects run-time type information (RTTI) onto a secret field on `function` objects.
At the moment, DTypeScript only emits this information on user-written functions, and not on functions in the browser environment.

### Checking Casts at Runtime

To check downcasts at runtime, DTypeScript dynamically checks the structure of the object against the type specified in the typecast. While it has the illusion of classes, TypeScript is actually 100% structurally typed.

For example, the following is valid TypeScript:

```typescript
class Foo {
  public x: number;
  public moveTo(): void {}
}
let v: Foo = {
  x: 3,
  moveTo = () => {}
};
```

Although `moveTo` is defined on `Foo.prototype`, it does not matter to TypeScript.

Thus, to check if a value can be cast to a type, DTypeScript does the following:

* If the type is a literal (e.g. `3`), it checks if the value is a literal with the same value.
* If the type is a primitive (e.g. `number`), it checks if the value is a primitive of the same type.
* If the type is a union (e.g. `number | string`), it checks each member of the union individually. If it matches one, then it passes.
* If the type is an intersection (e.g. `number & string`), it checks each member of the union individually and passes if it matches all of them.
* If the type is an object type (`interface`, `class`, object literal, anonymous type), it checks that:
  * The value contains all of the properties specified on the type, and that those properties contain values of the appropriate type.
  * The value contains all of the *call* and *construct* function signatures of the type, if specified. (Example: `Foo(3)` is a *call* signature with a single numeric argument, and `new Foo(3)` is a *construct* signature with a single numeric argument)
    * The value must be a function if call/construct signatures are specified.
    * If the function is tagged with a runtime type, it checks the signatures on that type. Else, the check trivially passes, as an untyped `Function` can be cast to any signature.
  * If the type contains an index type keyed on a number and the value is an array, it type checks that all values in the array correspond to the given type.
  * Note that TypeScript statically resolves these types into a flattened structural type, simplifying type checking.

## Limitations

DTypeScript has the following limitations.

### Modules

For engineering reasons, DTypeScript currently only works on an individual TypeScript file. It does not support modules in any way, but works perfectly fine with `namespace`s.

### Unassigned Non-optional Fields

If you have an object of a particular class with unassigned non-optional fields, that object will fail to dynamically type check because TypeScript does not assign a default value.

For example:

```typescript
class Foo {
  public x: number;
}
let x: any = new Foo();
<Foo> x; // x.x is not present on the object!
```

You can avoid this issue by always explicitly initializing fields:

```typescript
class Foo {
  public x: number = undefined;
}
let x: any = new Foo();
<Foo> x; // Passes because property is present, and undefined is assignable to number
```

### API Functions

DTypeScript assumes that all type annotations in the program are correct. If a section of the program interacts with the outside world, e.g. an API function, the developer should type the function arguments using the `any` type and type-cast the arguments to the appropriate type in the body to dynamically check that the developer is using the library appropriately.

### Incorrect Type Annotations

DTypeScript assumes that all program type annotations are correct. If you have an incorrect type annotation for something in the browser environment, DTypeScript will not find it. DTypeScript only checks types at dynamic casts and `eval`-like functions.

### Type casts with generics

The following is illegal in DTypeScript:

```typescript
function castToFooBar<T>(val: any): FooBar<T> {
  return <FooBar<T>> val;
}
```

Supporting this typecast would involve plumbing concrete generic types through the code. Such a transformation would require dynamically maintaining an evaluation context that contains all active type arguments. There may be more than one active context at once. For example:

```typescript
class Foo<T> extends Bar<U> {
  private _t: T;
  constructor (t: T, u: U) {
    super(u);
    this._t = t;
  }
  public getFizzBuzz<V>(v: V) {
    return this._constructFizzBuzz<V>(v);
  }
}
```

The type context needs to be saved into closures:

```typescript
function createTimeout<T>(t: T, callback: (a: T) => void): void {
  setTimeout(() => callback(t), 100);
}
```

It is *possible* to make code transformations that save the type context inside any scope that contains generics, but I decided not to implement them for this project.

### Branded objects

TypeScript programmers sometimes use [branded objects](https://michael.homer.nz/Publications/ECOOP2015/paper.pdf) to emulate nominal typing within TypeScript's structural types. For example, the TypeScript compiler defines `Path` as:

```typescript
type Path = string & { __pathBrand: boolean };
```

While a `Path` object will never actually have a `__pathBrand` property, the developer downcasts a `string` into a `Path` once it verifies that some invariant holds.

DTypeScript does not support branded objects, and all casts to branded objects will fail if the branded object field is not present.

### Index Signatures

Index signatures in TypeScript specify that an object provides a map from `number`s or `string`s to a particular type. For example, the following interface maps strings to `Foo`:

```typescript
interface FooMap {
  [name: string]: Foo;
}
```

Given a value at runtime, it is impossible to determine whether or not that object maintains a particular index signature. If the object contains an unspecified field that does not contain a `Foo`, that field could be part of a subtype. If the object does not contain any fields that contain a `Foo`, then it could be an empty map.

To support this use case, DTypeScript would need to store run-time type information into all objects at allocation time.

DTypeScript *does* check index types for arrays and for Function objects that contain a runtime type.

### `this` type

DTypeScript does not check that the `this` type on `Function` objects are consistent.

### Error Messages for `Function.prototype.(call|apply)`, `new Function`, `eval`

DTypeScript does not point out the correct source code location in function.call/apply/`eval`/`new Function` error messages. DTypeScript could use SourceMaps and a stack trace to determine the location, but does not.

