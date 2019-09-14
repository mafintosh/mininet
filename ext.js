'use strict'

class RemoteError extends Error {
  constructor ({ message, stack, name, type, ...rest }) {
    super(message)
    var localStack = this.stack
    this.stack = 'REMOTE STACK:\n' + stack + '\nLOCAL STACK:\n' + localStack
    this.remoteName = name
    Object.assign(this, rest)
  }
}

function serializeError (k, v) {
  if (v instanceof Error) {
    return {
      ...v,
      type: 'MininetSerializedError',
      name: v.name,
      message: v.message,
      stack: v.stack
    }
  }
  return v
}

function parseExtendedTypes (k, v) {
  if (v == null || typeof v !== 'object') return v
  if (v.type === 'MininetSerializedError') {
    return new RemoteError(v)
  }
  if (v.type === 'Buffer' && Array.isArray(v.data)) {
    return Buffer.from(v.data)
  }
  return v
}

module.exports = { serializeError, parseExtendedTypes }
