/**
 * @since 1.0.0
 */

import type { Annotations, Meta } from "@fp-ts/codec/Meta"
import type { Schema } from "@fp-ts/codec/Schema"
import * as S from "@fp-ts/codec/Schema"
import * as covariantSchema from "@fp-ts/codec/typeclass/CovariantSchema"
import * as ofSchema from "@fp-ts/codec/typeclass/OfSchema"
import type { TypeLambda } from "@fp-ts/core/HKT"
import { pipe } from "@fp-ts/data/Function"
import * as O from "@fp-ts/data/Option"

/**
 * @since 1.0.0
 */
export interface Guard<in out A> extends Schema<A> {
  readonly is: (input: unknown) => input is A
}

/**
 * @since 1.0.0
 */
export interface GuardTypeLambda extends TypeLambda {
  readonly type: Guard<this["Target"]>
}

/**
 * @since 1.0.0
 */
export const make = <A>(
  schema: Schema<A>,
  is: Guard<A>["is"]
): Guard<A> => ({ meta: schema.meta, is }) as any

/**
 * @since 1.0.0
 */
export const string: Guard<string> = make(
  S.string,
  (u: unknown): u is string => typeof u === "string"
)

/**
 * @since 1.0.0
 */
export const minLength = (minLength: number) =>
  <A extends { length: number }>(self: Guard<A>): Guard<A> =>
    make(
      S.minLength(minLength)(self),
      (a): a is A => self.is(a) && a.length >= minLength
    )

/**
 * @since 1.0.0
 */
export const maxLength = (
  maxLength: number
) =>
  <A extends { length: number }>(self: Guard<A>): Guard<A> =>
    make(
      S.maxLength(maxLength)(self),
      (a): a is A => self.is(a) && a.length <= maxLength
    )

/**
 * @since 1.0.0
 */
export const number: Guard<number> = make(
  S.number,
  (u: unknown): u is number => typeof u === "number"
)

/**
 * @since 1.0.0
 */
export const minimum = (minimum: number) =>
  <A extends number>(self: Guard<A>): Guard<A> =>
    make(
      S.minimum(minimum)(self),
      (a): a is A => self.is(a) && a >= minimum
    )

/**
 * @since 1.0.0
 */
export const maximum = (
  maximum: number
) =>
  <A extends number>(self: Guard<A>): Guard<A> =>
    make(
      S.maximum(maximum)(self),
      (a): a is A => self.is(a) && a <= maximum
    )

/**
 * @since 1.0.0
 */
export const boolean: Guard<boolean> = make(
  S.boolean,
  (u: unknown): u is boolean => typeof u === "boolean"
)

/**
 * @since 1.0.0
 */
export const lazy = <A>(
  symbol: symbol,
  f: () => Guard<A>
): Guard<A> => {
  const get = S.memoize<void, Guard<A>>(f)
  const schema = S.lazy(symbol, f)
  return make(
    schema,
    (a): a is A => get().is(a)
  )
}

// TODO: move to internal
const isUnknownIndexSignature = (u: unknown): u is { readonly [_: string]: unknown } =>
  typeof u === "object" && u != null && !Array.isArray(u)

/**
 * @since 1.0.0
 */
export interface GuardAnnotation {
  readonly _tag: "GuardAnnotation"
  readonly guardFor: (
    annotations: Annotations,
    ...guards: ReadonlyArray<Guard<any>>
  ) => Guard<any>
}

/**
 * @since 1.0.0
 */
export const isGuardAnnotation = (u: unknown): u is GuardAnnotation =>
  u !== null && typeof u === "object" && ("_tag" in u) && (u["_tag"] === "GuardAnnotation")

const go = S.memoize((meta: Meta): Guard<any> => {
  switch (meta._tag) {
    case "Apply": {
      const annotations = meta.annotations.filter(isGuardAnnotation)
      if (annotations.length > 0) {
        return annotations[0].guardFor(meta.annotations, ...meta.metas.map(go))
      }
      throw new Error(`Missing "GuardAnnotation" for ${meta.symbol.description}`)
    }
    case "String": {
      let out = string
      if (meta.minLength !== undefined) {
        out = minLength(meta.minLength)(out)
      }
      if (meta.maxLength !== undefined) {
        out = maxLength(meta.maxLength)(out)
      }
      return out
    }
    case "Number": {
      let out = number
      if (meta.minimum !== undefined) {
        out = minimum(meta.minimum)(out)
      }
      if (meta.maximum !== undefined) {
        out = maximum(meta.maximum)(out)
      }
      return out
    }
    case "Boolean":
      return boolean
    case "Of":
      return make(S.make(meta), (u): u is any => u === meta.value)
    case "Tuple": {
      const components = meta.components.map(go)
      const restElement = pipe(meta.restElement, O.map(go))
      return make(
        S.make(meta),
        (a): a is any =>
          Array.isArray(a) &&
          components.every((guard, i) => guard.is(a[i])) &&
          (pipe(
            restElement,
            O.map((rest) => a.slice(components.length).every(rest.is)),
            O.getOrElse(true)
          ))
      )
    }
    case "Union": {
      const members = meta.members.map(go)
      return make(
        S.make(meta),
        (a): a is any => members.some((guard) => guard.is(a))
      )
    }
    case "Struct": {
      const fields = {}
      for (const field of meta.fields) {
        fields[field.key] = go(field.value)
      }
      const oIndexSignature = pipe(meta.indexSignature, O.map((is) => go(is.value)))
      return make(
        S.make(meta),
        (a): a is any => {
          if (!isUnknownIndexSignature(a)) {
            return false
          }
          for (const key of Object.keys(fields)) {
            if (!fields[key].is(a[key])) {
              return false
            }
          }
          if (O.isSome(oIndexSignature)) {
            const indexSignature = oIndexSignature.value
            for (const key of Object.keys(a)) {
              if (!(key in fields) && !indexSignature.is(a[key])) {
                return false
              }
            }
          }
          return true
        }
      )
    }
    case "Lazy":
      return lazy(meta.symbol, () => go(meta.f()))
  }
})

/**
 * @since 1.0.0
 */
export const unsafeGuardFor = S.memoize(<A>(schema: Schema<A>): Guard<A> => go(schema.meta))

/**
 * @since 1.0.0
 */
export const FromSchema: ofSchema.OfSchema<GuardTypeLambda> = {
  ofSchema: unsafeGuardFor
}

/**
 * @since 1.0.0
 */
export const of: <A>(a: A) => Guard<A> = ofSchema.of(FromSchema)

/**
 * @since 1.0.0
 */
export const tuple: <Components extends ReadonlyArray<Schema<any>>>(
  ...components: Components
) => Guard<{ readonly [K in keyof Components]: Parameters<Components[K]["A"]>[0] }> = ofSchema
  .tuple(FromSchema)

/**
 * @since 1.0.0
 */
export const union: <Members extends ReadonlyArray<Schema<any>>>(
  ...members: Members
) => Guard<Parameters<Members[number]["A"]>[0]> = ofSchema
  .union(FromSchema)

/**
 * @since 1.0.0
 */
export const struct: <Fields extends Record<PropertyKey, Schema<any>>>(
  fields: Fields
) => Guard<{ readonly [K in keyof Fields]: Parameters<Fields[K]["A"]>[0] }> = ofSchema
  .struct(FromSchema)

/**
 * @since 1.0.0
 */
export const indexSignature: <A>(value: Schema<A>) => Guard<{
  readonly [_: string]: A
}> = ofSchema.indexSignature(FromSchema)

/**
 * @since 1.0.0
 */
export const readonlyArray: <A>(item: Schema<A>) => Guard<ReadonlyArray<A>> = ofSchema
  .readonlyArray(FromSchema)

/**
 * @since 1.0.0
 */
export const mapSchema = <A, B>(
  f: (schema: Schema<A>) => Schema<B>
) => (guard: Guard<A>): Guard<B> => unsafeGuardFor(f(guard))

/**
 * @since 1.0.0
 */
export const CovariantSchema: covariantSchema.CovariantSchema<GuardTypeLambda> = {
  imapSchema: covariantSchema.imap<GuardTypeLambda>(mapSchema),
  mapSchema
}

/**
 * @since 1.0.0
 */
export const optional: <A>(self: Guard<A>) => Guard<A | undefined> = covariantSchema.optional(
  CovariantSchema
)

/**
 * @since 1.0.0
 */
export const pick: <A, Keys extends ReadonlyArray<keyof A>>(
  ...keys: Keys
) => (self: Guard<A>) => Guard<{ [P in Keys[number]]: A[P] }> = covariantSchema.pick(
  CovariantSchema
)

/**
 * @since 1.0.0
 */
export const omit: <A, Keys extends ReadonlyArray<keyof A>>(
  ...keys: Keys
) => (self: Guard<A>) => Guard<{ [P in Exclude<keyof A, Keys[number]>]: A[P] }> = covariantSchema
  .omit(CovariantSchema)
