/**
 * Recursively creates a deep clone of the provided value.
 *
 * @param value - The value to be deep-cloned.
 * @returns A deep copy of the input value.
 */
export function cloneDeep<T>(value: T): T {
  // Return primitives and functions as-is.
  if (value === null || typeof value !== "object") {
    return value;
  }

  // Handle Date objects.
  if (value instanceof Date) {
    return new Date(value.getTime()) as any;
  }

  // Handle Arrays.
  if (Array.isArray(value)) {
    const arrCopy: any[] = [];
    for (const item of value) {
      arrCopy.push(cloneDeep(item));
    }
    return arrCopy as unknown as T;
  }

  // Handle plain objects.
  if (typeof value === "object") {
    const objCopy: { [key: string]: any } = {};
    // Only clone own properties.
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        objCopy[key] = cloneDeep((value as any)[key]);
      }
    }
    return objCopy as T;
  }

  // If value is of an unsupported type, return it directly.
  return value;
}
