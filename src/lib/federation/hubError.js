export class HubError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "HubError";
    this.status = status;
    this.body = body;
  }
}
