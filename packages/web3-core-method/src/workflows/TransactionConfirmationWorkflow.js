/*
 This file is part of web3.js.

 web3.js is free software: you can redistribute it and/or modify
 it under the terms of the GNU Lesser General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 web3.js is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU Lesser General Public License for more details.

 You should have received a copy of the GNU Lesser General Public License
 along with web3.js.  If not, see <http://www.gnu.org/licenses/>.
 */
/**
 * @file TransactionConfirmationWorkflow.js
 * @author Samuel Furter <samuel@ethereum.org>
 * @date 2018
 */

"use strict";

/**
 * @param {TransactionConfirmationModel} transactionConfirmationModel
 * @param {TransactionReceiptValidator} transactionReceiptValidator
 * @param {NewHeadsWatcher} newHeadsWatcher
 *
 * @constructor
 */
function TransactionConfirmationWorkflow(
    transactionConfirmationModel,
    transactionReceiptValidator,
    newHeadsWatcher
) {
    this.transactionConfirmationModel = transactionConfirmationModel;
    this.transactionReceiptValidator = transactionReceiptValidator;
    this.newHeadsWatcher = newHeadsWatcher;
}

/**
 * Executes the transaction confirmation workflow
 *
 * @method execute
 *
 * @param {AbstractMethodModel} methodModel
 * @param {AbstractProviderAdapter} provider
 * @param {String} transactionHash
 * @param {Object} promiEvent
 * @param {Function} callback
 *
 * @callback callback callback(error, result)
 */
TransactionConfirmationWorkflow.prototype.execute = function (
    methodModel,
    provider,
    transactionHash,
    promiEvent,
    callback
) {
    var self = this;
    this.methodModel = methodModel;
    this.provider = provider;
    this.promiEvent = promiEvent;
    this.callback = callback;

    this.getTransactionReceipt(transactionHash).then(function (receipt) {
        if (receipt && receipt.blockHash) {
            var validationResult = this.transactionReceiptValidator.validate(receipt);
            if (validationResult === true) {
                this.handleSuccessState(receipt);

                return;
            }

            self.handleErrorState(validationResult);

            return;
        }

        self.newHeadsWatcher.watch(provider).on('newHead', function () {
            self.transactionConfirmationModel.timeoutCounter++;
            if (!self.transactionConfirmationModel.isTimeoutTimeExceeded()) {
                self.getTransactionReceipt(transactionHash).then(function (receipt) {
                    var validationResult = self.transactionReceiptValidator.validate(receipt);
                    if (validationResult === true) {
                        self.transactionConfirmationModel.addConfirmation(receipt);
                        promiEvent.eventEmitter.emit(
                            'confirmation',
                            self.transactionConfirmationModel.confirmationsCount,
                            receipt
                        );

                        if (self.transactionConfirmationModel.isConfirmed()) {
                            self.handleSuccessState(receipt);
                        }

                        return;
                    }

                    promiEvent.reject(validationResult);
                    promiEvent.eventEmitter.emit('error', validationResult, receipt);
                    promiEvent.eventEmitter.removeAllListeners();
                    callback(validationResult, null);
                });

                return;
            }

            var error =  new Error('Transaction was not mined within '+ self.transactionConfirmationModel.TIMEOUTBLOCK +' blocks, please make sure your transaction was properly sent. Be aware that it might still be mined!');

            if (self.newHeadsWatcher.isPolling) {
                error = new Error('Transaction was not mined within' + self.transactionConfirmationModel.POLLINGTIMEOUT + ' seconds, please make sure your transaction was properly sent. Be aware that it might still be mined!')
            }

            self.handleErrorState(error);
        });
    });
};

/**
 * Get receipt by transaction hash
 *
 * @method execute
 *
 * @param {String} transactionHash
 *
 * @returns {Promise<Object>}
 */
TransactionConfirmationWorkflow.prototype.getTransactionReceipt = function (transactionHash) {
    return this.provider.send('eth_getTransactionReceipt', [transactionHash]).then(function (receipt) {
        return this.formatters.outputTransactionReceiptFormatter(receipt);
    })
};

/**
 * Resolves promise, emits receipt event, calls callback and removes all the listeners.
 *
 * @method handleSuccessState
 *
 * @param {Object} receipt
 *
 * @callback callback callback(error, result)
 */
TransactionConfirmationWorkflow.prototype.handleSuccessState = function (receipt) {
    this.newHeadsWatcher.stop();

    var mappedReceipt = this.methodModel.afterExecution(receipt);

    this.promiEvent.resolve(mappedReceipt);
    this.promiEvent.eventEmitter.emit('receipt', mappedReceipt);
    this.promiEvent.eventEmitter.removeAllListeners();

    this.callback(false, mappedReceipt);
};

/**
 * Rejects promise, emits error event, calls callback and removes all the listeners.
 *
 * @method handleErrorState
 *
 * @param {Error} error
 *
 * @callback callback callback(error, result)
 */
TransactionConfirmationWorkflow.prototype.handleErrorState = function (error) {
    this.newHeadsWatcher.stop();

    this.promiEvent.reject(error).apply(error);
    this.promiEvent.eventEmitter.emit('error', error);
    this.promiEvent.eventEmitter.removeAllListeners();

    this.callback(error, null);
};

module.exports = TransactionConfirmationWorkflow;