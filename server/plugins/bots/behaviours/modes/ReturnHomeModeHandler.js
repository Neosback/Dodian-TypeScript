class ReturnHomeModeHandler {
  handleBlocked() {
    // Return-home flow is resolved by its action node.
    return true;
  }
}

module.exports = {
  ReturnHomeModeHandler,
};

