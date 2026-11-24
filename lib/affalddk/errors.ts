export class AffaldDKNotSupportedError extends Error {
  constructor(message = 'Municipality not supported') { super(message); this.name = 'AffaldDKNotSupportedError'; }
}
export class AffaldDKNotValidAddressError extends Error {
  constructor(message = 'Address not found') { super(message); this.name = 'AffaldDKNotValidAddressError'; }
}
export class AffaldDKNoConnection extends Error {
  constructor(message = 'System API is currently not available') { super(message); this.name = 'AffaldDKNoConnection'; }
}
