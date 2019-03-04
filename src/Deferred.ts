export class Deferred<T> implements Promise<T> {
  public resolve: (value?: T | PromiseLike<T>) => void;
  public reject: (reason?: any) => void;

  public [Symbol.toStringTag]: "Deferred";
  private promise: Promise<T>;

  public constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  public then<TResult1 = T, TResult2 = never>(
    onfulfilled?: (value: T) => TResult1 | PromiseLike<TResult1>,
    onrejected?: (reason: any) => TResult2 | PromiseLike<TResult2>,
  ): Promise<TResult1 | TResult2> {
    return this.promise.then(onfulfilled, onrejected);
  }

  public catch<TResult = never>(
    onrejected?: (reason: any) => TResult | PromiseLike<TResult>,
  ): Promise<T | TResult> {
    return this.promise.catch(onrejected);
  }

  public finally(onfinally?: () => void): Promise<T> {
    throw this.promise.finally(onfinally);
  }
}
