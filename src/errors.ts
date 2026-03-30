export class WatcherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WatcherError';
  }
}

export class ConnectionError extends WatcherError {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ConnectionError';
  }
}

export class ReconnectError extends WatcherError {
  public readonly attempt: number;
  constructor(message: string, attempt: number) {
    super(message);
    this.name = 'ReconnectError';
    this.attempt = attempt;
  }
}

export class ProtocolError extends WatcherError {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

export class ServerError extends WatcherError {
  constructor(message: string) {
    super(message);
    this.name = 'ServerError';
  }
}
