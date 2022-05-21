const expressCheckoutSystemsNames = {
    applePay: 'applePay',
    payPal: 'paypal',
    googlePay: 'googlePay'
};

const availableModes = {
    basket: 'basket',
    product: 'product'
}

var expressCheckoutApi = {
    googlePayIFrameContainer: null,
    /**
     * Dane inicjalizujące dany system płatności
     */
    paymentSystemInitialData: null,
    /**
     * Dostępne kraje
     */
    availableCountries: null,
    /**
     * Dostawcy
     */
    deliveries: null,
    /**
     * Koszyk
     */
    basket: null,
    /**
     * Event kliku w przycisk express checkoutu
     */
    triggerEvent: null,
    /**
     * Ostatnia zapisana wartość koszyka
     */
    lastBasketWorth: null,
    /**
     * basket/product
     */
    mode: null,
    /**
     * Czy jest to pierwsza zmiana adresu dostawy (wykonuje się zaraz po odpaleniu formatki płatniczej)
     */
    firstDeliveryContactChange: null,
    /**
     * Systemy płatności, które wymagają pobrania danych inicjujących przed kliknięciem w przycisk
     */
    paymentSystemRequiredInitialDataBeforeClick: [expressCheckoutSystemsNames.applePay],
    test: function() {
        console.log("TEST");
    },
    /**
     * Pobiera dane z GraphQL
     *
     * @param dataFetch - zapytanie graphQL
     * @return {Promise<boolean|any>}
     */
    fetchData: async (dataFetch) => {
        try {
            const response = await fetch('/graphql/v1/', {
                method: 'POST',
                headers: {'Content-Type': 'application/json', Accept: 'application/json'},
                body: dataFetch,
            });
            const dataJson = await response.json();

            return dataJson;
        } catch (error) {
            console.error('AJAX fetchData() Error:', error);
            expressCheckoutApi.displayError();
            throw error;
        }
    },
    /**
     * Pobiera dane inicjujące dla systemu płatności
     *
     * @param system - system płatności
     * @return {Promise<boolean|*>}
     */
    fetchPaymentSystemInitialData: async (system) => {
        let paymentData = {
            action:'getPaymentSystemInitialData',
            system:system,
        }
        let ret = await expressCheckoutApi.postPaymentData(paymentData);

        return ret.data.expressCheckout.data;
    },
    /**
     * Pobiera dostępnych dostawców
     *
     * @param mode      - tryb działania
     * @param regionId  - identyfikator regionu
     * @return {Promise<*|boolean>}
     */
    getAvailableDeliveries: async(mode, regionId) => {
        let regionPart = (typeof(regionId) === 'undefined' ? '' : ', forcedRegion:' + regionId);
        let fetchDataQuery = JSON.stringify(
            {
                query: `query{
                  shipping(ShippingInput:{mode:${mode}` + regionPart + `}){
                    shipping{
                      courier{
                        id
                        name
                      }
                      prepaid
                      cost{
                        value
                        currency
                      }
                    }
                  }
                }`,
            }
        );
        let ret = await expressCheckoutApi.fetchData(fetchDataQuery);
        let shippingOptions = [];
        if (typeof(ret.data.shipping.shipping) != 'undefined') {
            for (let i = 0; i < ret.data.shipping.shipping.length; i++) {
                if (ret.data.shipping.shipping[i].prepaid !== 'prepaid' || ret.data.shipping.shipping[i].courier.name === '') {
                    continue;
                }
                shippingOptions.push(ret.data.shipping.shipping[i]);
            }
            if (shippingOptions.length > 0) {
                let lowestCostVal = shippingOptions.reduce(function (prev, curr) {
                    return (prev.cost.value < curr.cost.value) ? prev : curr;
                });
                if (lowestCostVal.cost.value != shippingOptions[0].cost.value) {
                    shippingOptions.sort(function (x, y) {
                        return x.courier.id === lowestCostVal.courier.id ? -1 : y === lowestCostVal.courier.id ? 1 : 0
                    });
                }

                shippingOptions = shippingOptions.slice(0,10);
            }
        }
        if (shippingOptions.length > 0) {
            ret.data.shipping.shipping = shippingOptions;
        }

        return ret;
    },
    /**
     * Pobiera dostępne kraje
     *
     * @return {Promise<boolean|*>}
     */
    getAvailableCountries: async() => {
        let fetchDataQuery = JSON.stringify(
            {
                query: `query{
                  shop{
                    countries {
                      available {
                        id
                        iso
                      }
                      current {
                        id
                        name
                        iso
                      }
                    }
                  }
                }`,
            }
        );
        return await expressCheckoutApi.fetchData(fetchDataQuery);
    },
    /**
     * Pobiera koszyk
     *
     * @return {Promise<*|boolean>}
     */
    getBasket: async() => {
        let fetchDataQuery = JSON.stringify(
            {
                query: `query{
                  basket(BasketCostInput: {}){
                    basketCost {
                      totalToPay {
                        value
                        currency
                      }
                    }
                    summaryBasket {
                      productsCount
                      worth {
                        gross {
                          value
                          currency
                        }
                        net {
                          value
                          currency
                        }
                      }
                      shipping {
                        cost {
                          gross {
                            value
                            currency
                          }
                          net {
                            value
                            currency
                          }
                        }
                      }
                    }
                    products {
                      id
                      size
                      quantity
                      worth {
                        gross {
                          value
                          currency
                        }
                        net {
                          value
                          currency
                        }
                      }
                      data {
                        name
                        link
                        description
                        icon
                      }
                    }
                  }
                }`,
            }
        );
        let basketContent = await expressCheckoutApi.fetchData(fetchDataQuery);

        return basketContent;
    },
    /**
     * Renderuje przycisk danego systemu płatności
     *
     * @param system    - system płatności
     * @param element   - element w którym ma być wyświetlony przycisk
     * @return {Promise<void>}
     */
    renderButton: async(system, element) => {
        if (system == expressCheckoutSystemsNames.payPal) {
            expressCheckoutApi.initPaypal(element.id, availableModes.product);
        }
        if (system == expressCheckoutSystemsNames.applePay) {
            expressCheckoutApi.renderApplePayButton(element.id, availableModes.product);
        }
        if (system == expressCheckoutSystemsNames.googlePay) {
            expressCheckoutApi.renderGooglePayButton(element.id, availableModes.product);
        }
    },
    /**
     * Renderuje przycisk danego systemu płatności na koszyku
     *
     * @param system    - system płatności
     * @param element   - element w którym ma być wyświetlony przycisk
     * @return {Promise<void>}
     */
    basketCheckout: async(system, element) => {
        if (system == expressCheckoutSystemsNames.payPal) {
            expressCheckoutApi.initPaypal(element.id, availableModes.basket);
        }
        if (system == expressCheckoutSystemsNames.applePay) {
            expressCheckoutApi.renderApplePayButton(element.id, availableModes.basket);
        }
        if (system == expressCheckoutSystemsNames.googlePay) {
            expressCheckoutApi.renderGooglePayButton(element.id, availableModes.basket);
        }
    },
    /**
     * Aktualizuje dane zamówienia w zew. COP
     *
     * @param system            - system płatności
     * @param orderId           - identyfikator zamówienia w zew. COP
     * @param regionId          - identyfikator regionu w zew. COP
     * @param shippingOptions   - lista dostaw
     *
     * @return {Promise<*|boolean>}
     */
    updateOrderParams: async(system, orderId, regionId, shippingOptions) => {
        let paymentData = {
            action:'updateOrderParams',
            orderId:orderId,
            system:system,
            regionId:regionId,
            shippingOptions:shippingOptions
        }
        paymentData = escape(JSON.stringify(paymentData));
        let fetchDataQuery = JSON.stringify(
            {
                query: `mutation{
                  expressCheckout(ExpressCheckoutInput: "` + paymentData + `"){
                    status
                    data
                  }
                }`,
            }
        );
        let ret = await expressCheckoutApi.fetchData(fetchDataQuery);
        ret = JSON.parse(unescape(ret.data.expressCheckout.data));

        return ret;
    },
    /**
     * Tworzy płatność
     *
     * @param system - system płatności
     * @return {Promise<*>}
     */
    createPayment: async(system) => {
        let fetchDataQuery = JSON.stringify(
            {
                query: `mutation{
                  expressCheckoutCreatePayment(CreatePaymentInput: {
                    system:"${system}"
                  }){
                    status
                    data
                  }
                }`,
            }
        );
        let ret = await expressCheckoutApi.fetchData(fetchDataQuery);
        ret.data.expressCheckout = {};
        ret.data.expressCheckout.data = JSON.parse(ret.data.expressCheckoutCreatePayment.data);

        return ret.data.expressCheckout.data;
    },
    /**
     * Usuwa wybranego kuriera z sesji
     *
     * @return {Promise<*>}
     */
    deleteSelectedCourier: async() => {
        let fetchDataQuery = JSON.stringify({
            query: `mutation{
              expressCheckoutDeleteCourier{
                status
              }
            }`
        });
        let ret = await expressCheckoutApi.fetchData(fetchDataQuery);

        return ret.data.expressCheckoutDeleteCourier.status;
    },
    restoreBasket: async() => {
        let paymentData = {
            action:'restoreBasket',
        }
        paymentData = escape(JSON.stringify(paymentData));
        let fetchDataQuery = JSON.stringify(
            {
                query: `mutation{
                  expressCheckout(ExpressCheckoutInput: "` + paymentData + `"){
                    status
                    data
                  }
                }`,
            }
        );
        let ret = await expressCheckoutApi.fetchData(fetchDataQuery);
        ret = JSON.parse(unescape(ret.data.expressCheckout.data));

        return ret;
    },
    /**
     * Zapisuje wybranego kuriera w sesji
     *
     * @param courierId - identyfikator dostawcy
     * @param system - system płatności
     * @param paymentAmount - wartość płatności w zew COP.
     * @param paymentCurrency - waluta płatności w zew COP.
     * @return {Promise<*>}
     */
    saveSelectedCourier: async(courierId, system, paymentAmount, paymentCurrency) => {
        let fetchDataQuery = JSON.stringify({
            query: `mutation{
              expressCheckoutSaveCourierAndPaymentAmount(SaveCourierAndPaymentAmountInput: {
                courierId:${courierId}
                system:"${system}"
                paymentAmount:${paymentAmount}
                paymentCurrency:"${paymentCurrency}"
              }){
                status
              }
            }`
        });
        let ret = await expressCheckoutApi.fetchData(fetchDataQuery);

        return ret.data.expressCheckoutSaveCourierAndPaymentAmount.status;
    },
    /**
     * Pobieranie danych płatności
     *
     * @param paymentData   - zapytanie o dane płatności
     * @return {Promise<*|boolean>}
     */
    postPaymentData: async(paymentData) => {
        paymentData = escape(JSON.stringify(paymentData));
        let fetchDataQuery = JSON.stringify(
            {
                query: `mutation{
                  expressCheckout(ExpressCheckoutInput: "` + paymentData + `"){
                    status
                    data
                  }
                }`,
            }
        );
        let ret = await expressCheckoutApi.fetchData(fetchDataQuery);
        if (ret.data.expressCheckout.data) {
            ret.data.expressCheckout.data = JSON.parse(unescape(ret.data.expressCheckout.data));
        }

        return ret;
    },
    /**
     * Inicjuje system płatności PayPal
     *
     * @param elementId - element w którym ma być wyświetlony przycisk
     * @param mode - product/basket
     * @return {Promise<void>}
     */
    initPaypal: async(elementId, mode) => {
        await attachPaypalJs().then(() => {
            let button = paypal_sdk.Buttons({
                env: 'sandbox', // sandbox | production         @TODO zmienić

                // Set style of buttons
                style: {
                    layout: 'horizontal',   // horizontal | vertical <-Must be vertical for APMs
                    size:   'responsive',   // medium | large | responsive
                    shape:  'rect',         // pill | rect
                    color:  'gold',         // gold | blue | silver | black,
                    fundingicons: false,    // true | false,
                    tagline: false,         // true | false,
                },

                createOrder: async function() {
                    if (mode == 'product') {
                        //w trybie "towar" musimy dodać tylko wybrany towar do koszyka

                        await app_shop.fn.getExpressCheckoutData(document.getElementById(elementId));
                    }

                    let paypalPaymentData = await expressCheckoutApi.createPayment(expressCheckoutSystemsNames.payPal);

                    return paypalPaymentData.id;
                },

                onShippingChange: async function(data, actions) {
                    let countries = await expressCheckoutApi.getAvailableCountries();
                    let selectedRegion = 0;
                    if (typeof(countries.data) != 'undefined' && (countries.data.shop.countries.available || countries.data.shop.countries.current.iso) && typeof(data.shipping_address.country_code) != 'undefined') {
                        if (data.shipping_address.country_code.toLowerCase() == countries.data.shop.countries.current.iso.toLowerCase()) {
                            selectedRegion = countries.data.shop.countries.current.id;
                        } else {
                            for (var i = 0; i < countries.data.shop.countries.available.length; i++) {
                                if (countries.data.shop.countries.available[i].iso == data.shipping_address.country_code.toLowerCase()) {
                                    //mamy wybrany region klienta dostępny w sklepie
                                    selectedRegion = countries.data.shop.countries.available[i].id;
                                    break;
                                }
                            }
                        }
                    }
                    if (selectedRegion === 0) {
                        //nie obsługujemy takiego kraju - info do paypala że tego adresu nie obsłużymy
                        return actions.reject();
                    }
                    let cleanedSessionCourier = await expressCheckoutApi.deleteSelectedCourier();
                    if (cleanedSessionCourier !== 'success') {
                        expressCheckoutApi.displayError();
                    }
                    let shippingOptions = await expressCheckoutApi.getAvailableDeliveries(availableModes.basket, selectedRegion);
                    if (typeof(data.selected_shipping_option.id) != 'undefined') {
                        let allowCourier = false;
                        for (let i = 0; i < shippingOptions.data.shipping.shipping.length; i++) {
                            if (data.selected_shipping_option.id == shippingOptions.data.shipping.shipping[i].courier.id) {
                                allowCourier = true;
                                break;
                            }
                        }
                        if (allowCourier) {
                            let courierChanged = await expressCheckoutApi.saveSelectedCourier(data.selected_shipping_option.id, expressCheckoutSystemsNames.payPal, null, null);
                            if (courierChanged !== 'success') {
                                expressCheckoutApi.displayError();
                            }
                        }
                    }
                    let newParams = await expressCheckoutApi.updateOrderParams(expressCheckoutSystemsNames.payPal, '', selectedRegion, shippingOptions);

                    return actions.order.patch([
                        {
                            op: "replace",
                            path: "/purchase_units/@reference_id=='default'/amount",
                            value: newParams[0].amount
                        },
                        {
                            op: "replace",
                            path: "/purchase_units/@reference_id=='default'/shipping/options",
                            value: newParams[0].shipping.options
                        }
                    ]);
                },

                onApprove: async function(data, actions) {
                    let url = '';
                    if (typeof(data.orderID) != 'undefined' && typeof(data.facilitatorAccessToken) != 'undefined') {
                        //mamy dane od paypala - id zamówienia i token. Trzeba je przeprocesować.
                        let proceeded = await expressCheckoutApi.proceedPayment(expressCheckoutSystemsNames.payPal, data.orderID, data.facilitatorAccessToken);
                        if (typeof(proceeded.data) != 'undefined') {
                            url = proceeded.data;
                        }
                    }

                    if (typeof(url) == 'string' && url !== '') {
                        window.location.replace(url);
                    } else if (typeof(Alertek) === 'object') {
                        expressCheckoutApi.displayError();
                    }
                },

                onCancel: async function(data) {
                    expressCheckoutApi.restoreBasket();
                }
            })
            if (button.isEligible()) {
                button.render('#' + elementId);
            }
        });
    },

    /**
     * Przygotowuje dane inicjalizujące dla systemu płatności
     *
     * @param system - system płatności
     * @return {Promise<void>}
     */
    prepareInitDataBeforeClick: async(system) => {
        expressCheckoutApi.paymentSystemInitialData = await expressCheckoutApi.fetchPaymentSystemInitialData(system);
    },
    /**
     * Pobiera wartość koszyka zapisując go od razu jako ostatnia znana wartość
     *
     * @param basketWorth   - wartość koszyka
     * @param deliveryWorth - wartość kosztu dostawy
     * @return {null}
     */
    getBasketWorth: (basketWorth, deliveryWorth) => {
        expressCheckoutApi.lastBasketWorth = Number.parseFloat((basketWorth + deliveryWorth).toFixed(2));

        return expressCheckoutApi.lastBasketWorth;
    },
    initCheckout: async (currentId, serializeForm) => {
        await expressCheckoutApi.setBasket(serializeForm);
    },
    /**
     * Zmiana dostawcy
     *
     * @param selectedDeliveryId    - identyfikator wybranego dostawcy
     * @param system                - system płatności
     * @return {Promise<*>}
     */
    deliveryChanged: async (selectedDeliveryId, system) => {
        let selectedDeliveryData = null;
        const deliveriesShipping = expressCheckoutApi.deliveries.data.shipping.shipping;
        for (let i = 0; i < deliveriesShipping.length; i++) {
            if (deliveriesShipping[i].courier.id.toString() === selectedDeliveryId) {
                selectedDeliveryData = deliveriesShipping[i];
                break;
            }
        }

        if (selectedDeliveryData === null) {
            //dotarliśmy tutaj, więc coś się nie zgadza, bo nie znaleźliśmy u nas żadnego dostawcy pasującego do zwortki z Apple, rzucamy błąd
            throw {
                errorType: 'selectedDeliveryInvalid',
                message: 'Can\'t find selected deliverier from external COP'
            };
        }

        const basketWorth = expressCheckoutApi.getBasketWorth(expressCheckoutApi.basket.data.basket.summaryBasket.worth.gross.value, selectedDeliveryData.cost.value);

        if (await expressCheckoutApi.saveSelectedCourier(selectedDeliveryData.courier.id, system, basketWorth, expressCheckoutApi.paymentSystemInitialData.currencyFromSession) !== 'success') {
            throw {
                errorType: 'unknown',
                message: 'Can\'t save selected deliverier'
            };
        }

        return basketWorth;
    },
    /**
     * Renderuje przycisk systemu płatności Apple Pay
     *
     * @param elementId - element w którym ma być wyświetlony przycisk
     * @param mode      - product/basket
     * @return {Promise<void>}
     */
    renderApplePayButton: async (elementId, mode) => {
        let mainContainer = document.getElementById(elementId);
        mainContainer.classList.add('--loading');
        expressCheckoutApi.mode = mode;

        await expressCheckoutApi.prepareInitDataBeforeClick(expressCheckoutSystemsNames.applePay);

        let buttonDiv = document.createElement('div');
        buttonDiv.id = 'apple-pay-button';
        buttonDiv.style = 'width: 100%; height: 30px; -webkit-appearance: -apple-pay-button; -apple-pay-button-type: plain; -apple-pay-button-style: white-outline;';
        buttonDiv.className = '';
        buttonDiv.lang = 'PL';
        buttonDiv.onclick = (event) => { expressCheckoutApi.initApplePay(event) };
        mainContainer.appendChild(buttonDiv);
        mainContainer.classList.remove('--loading');
    },
    /**
     * Inicjuje system płatności Apple Pay
     */
    initApplePay:(event) => {
        expressCheckoutApi.triggerEvent = event;
        const verifyMerchant = async function () {
            const response = await expressCheckoutApi.createPayment(expressCheckoutSystemsNames.applePay);
            const dataJson = await response.data;

            if (dataJson.errno == 0) {
                return dataJson;
            } else {
                expressCheckoutApi.displayError();
                throw "Cannot verify merchant";
            }
        }();

        if (expressCheckoutApi.paymentSystemInitialData == null) {
            expressCheckoutApi.displayError();
            return;
        }
        expressCheckoutApi.firstDeliveryContactChange = true;
        expressCheckoutApi.setDefaultDeliverie();
        let deliveriesMethod = expressCheckoutApi.getAvailableDeliveriesForApplePay(expressCheckoutApi.deliveries)
        let m = new Merchant(
            expressCheckoutApi.paymentSystemInitialData.merchantAppleId,
            "PL",
            verifyMerchant, '', '', '',
            deliveriesMethod,
            expressCheckoutApi.deliveryChangedApplePay,
            expressCheckoutApi.deliveryContactChangedApplePay,
            expressCheckoutApi.proceedPaymentApplePay,
            expressCheckoutApi.restoreBasket);
        let t = new Transaction(
            0,
            expressCheckoutApi.paymentSystemInitialData.currencyFromSession,
            expressCheckoutApi.paymentSystemInitialData.label,
        );
        let p = new ProcessExpressCheckout(m, t);
        p.do();
    },
    /**
     * Pobiera dostępnych dostawców w formacie zgodnym z wymaganiami Apple Pay
     *
     * @param deliveriesData - dane dostawców
     * @return {[]}
     */
    getAvailableDeliveriesForApplePay: (deliveriesData) => {
        if (deliveriesData == null || deliveriesData === 'undefined' || deliveriesData.data == null || deliveriesData.data === 'undefined') {
            expressCheckoutApi.displayError();
            return;
        }
        const deliveriesShipping = deliveriesData.data.shipping.shipping;
        let deliveriesForApplePay = [];
        for (let i = 0; i < deliveriesShipping.length; i++) {
            deliveriesForApplePay.push({
                identifier: deliveriesShipping[i].courier.id,
                label: deliveriesShipping[i].courier.name,
                amount: deliveriesShipping[i].cost.value,
                detail: deliveriesShipping[i].courier.name
            })
        }

        return deliveriesForApplePay;
    },
    /**
     * Akcja wykonywana, gdy klient zmienił dostawcę na formatce płatniczej Apple Pay
     *
     * @param selectedDelivery  - wybrany dostawca
     * @return {Promise<{newTotal: {amount: *}}>}
     */
    deliveryChangedApplePay: async (selectedDelivery) => {
        let amount = 0;
        try {
            amount = await expressCheckoutApi.deliveryChanged(selectedDelivery.identifier, expressCheckoutSystemsNames.applePay);
        } catch (error) {
            expressCheckoutApi.displayError();
            throw error.message;
        }
        return {
            newTotal: {
                amount: amount
            }
        };
    },
    /**
     * Akcja wykonywana, gdy klient zmienił adres dostawy na formatce płatniczej Apple Pay
     *
     * @param selectedContactDelivery - zmieniony adres dostawy
     * @return {Promise<{errors: [*], newTotal: {amount: null}}|{newShippingMethods: *[], newTotal: {amount: *}}>}
     */
    deliveryContactChangedApplePay: async (selectedContactDelivery) => {
        if (expressCheckoutApi.firstDeliveryContactChange === true) {
            if (expressCheckoutApi.mode == 'product') {
                //w trybie "towar" musimy dodać tylko wybrany towar do koszyka
                await app_shop.fn.getExpressCheckoutData(expressCheckoutApi.triggerEvent);
            }
            expressCheckoutApi.basket = await expressCheckoutApi.getBasket();
            expressCheckoutApi.firstDeliveryContactChange = false;
        }
        let countries = await expressCheckoutApi.getAvailableCountries();
        let selectedRegion = 0;
        if (typeof(countries.data) != 'undefined' && (countries.data.shop.countries.available || countries.data.shop.countries.current.iso) && typeof(selectedContactDelivery.countryCode) != 'undefined') {
            if (selectedContactDelivery.countryCode.toLowerCase() == countries.data.shop.countries.current.iso.toLowerCase()) {
                selectedRegion = countries.data.shop.countries.current.id;
            } else {
                for (var i = 0; i < countries.data.shop.countries.available.length; i++) {
                    if (countries.data.shop.countries.available[i].iso == selectedContactDelivery.countryCode.toLowerCase()) {
                        //mamy wybrany region klienta dostępny w sklepie
                        selectedRegion = countries.data.shop.countries.available[i].id;
                        break;
                    }
                }
            }
        }

        if (selectedRegion === 0) {
            //nie obsługujemy takiego kraju - info do applePay że tego adresu nie obsłużymy
            return {
                newTotal: {
                    amount: expressCheckoutApi.lastBasketWorth,
                },
                errors: [
                    new ApplePayError('shippingContactInvalid', 'countryCode', 'This country is not supported')
                ]
            }
        }
        //trzeba też zmieniać listę kurierów w zamówieniu i kwotę za wysyłkę
        expressCheckoutApi.deliveries = await expressCheckoutApi.getAvailableDeliveries(availableModes.basket, selectedRegion);
        let shippingMethods = expressCheckoutApi.getAvailableDeliveriesForApplePay(expressCheckoutApi.deliveries);
        const basketWorth = expressCheckoutApi.getBasketWorth(expressCheckoutApi.basket.data.basket.summaryBasket.worth.gross.value, shippingMethods[0].amount);
        if (await expressCheckoutApi.saveSelectedCourier(expressCheckoutApi.deliveries.data.shipping.shipping[0].courier.id, expressCheckoutSystemsNames.applePay, basketWorth, expressCheckoutApi.paymentSystemInitialData.currencyFromSession) !== 'success') {
            expressCheckoutApi.displayError();
            throw 'Can\'t save selected deliverier';
        }

        return {
            newTotal: {
                amount: basketWorth,
            },
            newShippingMethods: shippingMethods
        };
    },
    /**
     * Proceduje token płatności Apple Pay
     *
     * @param paymentToken - token płatniczy
     * @return {Promise<void>}
     */
    proceedPaymentApplePay: async (paymentToken) => {
        let url = '';

        localStorage.setItem('applePayToken', JSON.stringify(paymentToken.token));
        let proceeded = await expressCheckoutApi.proceedPayment(
            expressCheckoutSystemsNames.applePay,
            paymentToken.token.transactionIdentifier,
            expressCheckoutApi.b64EncodeUnicode(JSON.stringify(paymentToken))
        );
        if (typeof(proceeded.data) != 'undefined') {
            url = proceeded.data;
        }

        if (typeof(url) == 'string' && url !== '') {
            window.location.replace(url);
        } else {
            expressCheckoutApi.displayError();
        }
    },
    /**
     * Renderuje przycisk systemu płatności Google Pay
     *
     * @param elementId - element w którym ma być wyświetlony przycisk
     * @param mode      - product/basket
     * @return {Promise<void>}
     */
    renderGooglePayButton: (elementId, mode) => {
        window.addEventListener('message', expressCheckoutApi.googlePayListener);
        const mainContainer = document.getElementById(elementId);
        expressCheckoutApi.googlePayIFrameContainer = mainContainer;
        expressCheckoutApi.displayGooglePayLoader(true);
        expressCheckoutApi.mode = mode;
        const googlePayIFrame = document.createElement('iframe');
        googlePayIFrame.src ='https://payment.idosell.com/assets/html/googlePay.html?expressCheckout=yes&FFFixed=yes&origin=' + encodeURIComponent(expressCheckoutApi.getLocationDomain());
        googlePayIFrame.frameBorder = '0';
        googlePayIFrame.allowPaymentRequest = true;
        googlePayIFrame.style = 'width: calc(100% + 16px); height: 60px; margin: 0 -8px;';
        googlePayIFrame.scrolling = 'no';
        mainContainer.appendChild(googlePayIFrame);
    },
    /**
     * Listener zdarzeń Google Pay z iFrame
     *
     * @param event - zdarzenie
     * @return {Promise<void>}
     */
    googlePayListener: async (event) => {
        if (event.origin !== 'https://payment.idosell.com')
            return;

        if (event.ports.length === 0)
            return;

        if (typeof event.data !== 'object' || event.data.method === null || event.data.method === undefined) {
            return;
        }

        event.data.arguments = JSON.parse(event.data.arguments);

        try {
            let result = null;
            switch (event.data.method) {
                case "init": {
                    result = await expressCheckoutApi.initGooglePay();
                    break;
                }
                case "displayLoader": {
                    await expressCheckoutApi.displayGooglePayLoader(event.data.arguments);
                    break;
                }
                case "getGoogleShippingAddressParameters": {
                    result = expressCheckoutApi.getGoogleShippingAddressParameters();
                    break;
                }
                case "onPaymentDataChanged": {
                    result = await expressCheckoutApi.onPaymentDataChangedGooglePay(event.data.arguments);
                    break;
                }
                case "proceedPayment": {
                    result = await expressCheckoutApi.proceedPaymentGooglePay(event.data.arguments);
                    break;
                }
                case "cancelPayment": {
                    result = await expressCheckoutApi.restoreBasket();
                    break;
                }
                case "displayError": {
                    await expressCheckoutApi.displayError(event.data.arguments);
                    break;
                }
                case "redirect": {
                    expressCheckoutApi.redirectOrder(event.data.arguments);
                    break;
                }
            }
            event.ports[0].postMessage({result: JSON.stringify(result)});
        } catch (error) {
            event.ports[0].postMessage({error: error.message});
        }
    },
    /**
     * Wykonuje komunikację do API Google Pay
     *
     * @param method    - nazwa metody w API Express Checkout
     * @param arguments - argumenty jakie mają być przekazane
     * @param iFrame    - iFrame w którym jest API Google Pay
     *
     * @return {Promise<any>}
     */
    requestGooglePayJSApi: async (method, arguments, iFrame) => {
        if (arguments === undefined) {
            arguments = null;
        }
        return new Promise((res, rej) => {
            const channel = new MessageChannel();

            channel.port1.onmessage = ({data}) => {
                channel.port1.close();
                if (data.error) {
                    rej(data.error);
                } else {
                    res(JSON.parse(data.result));
                }
            };

            // send the other end
            const request = {
                method: method,
                arguments: JSON.stringify(arguments)
            };
            iFrame.contentWindow.postMessage(request, 'https://payment.idosell.com', [channel.port2]);
        });
    },
    /**
     * Wyświetla loader na przycisku Google Pay
     *
     * @param enabled
     */
    displayGooglePayLoader: (enabled) => {
        if (enabled === true) {
            expressCheckoutApi.googlePayIFrameContainer.classList.add('--loading');
        } else {
            expressCheckoutApi.googlePayIFrameContainer.classList.remove('--loading');
        }
    },
    /**
     * Inicjuje płatność Express Checkout Google Pay
     *
     * @return {Promise<{defaultShippingOptions: {defaultSelectedOptionId: *, shippingOptions: []}, transactionDetails: {totalPrice: *, mid: *, currencyCode: *}}>}
     */
    initGooglePay: async () => {
        const localStorageKey = 'googleExpressCheckoutInitData_' + expressCheckoutApi.getCookie('REGID') + '_' + expressCheckoutApi.getCookie('LANGID') + '_' + expressCheckoutApi.getCookie('CURRID');
        let cachedDataJson = localStorage.getItem(localStorageKey);
        let paymentSystemData = null;
        let availableCountries = null;
        let cachedData = null;

        if (cachedDataJson !== null) {
            cachedData = JSON.parse(cachedDataJson);
            // cache był stworzony ponad godzinę temu, kasujemy i pobieramy od nowa
            if (Math.floor(Date.now() / 1000) - cachedData.createTime > 3600) {
                localStorage.removeItem(localStorageKey);
                cachedData = null;
            }
        }
        if (cachedData === null) {
            // kasujemy dane inicjujące z Local Storage, które mogły istnieć pod innymi kluczami
            Object.keys(localStorage).forEach(el => {
                if (el.startsWith('googleExpressCheckoutInitData_')) {
                    localStorage.removeItem(el);
                }
            });

            const response = await expressCheckoutApi.createPayment(expressCheckoutSystemsNames.googlePay);
            paymentSystemData = await response.data;

            if (paymentSystemData.errno != 0) {
                expressCheckoutApi.displayError();
                throw "Init error";
            }

            availableCountries = await expressCheckoutApi.getAvailableCountries();
            cachedData = {
                paymentSystemData: paymentSystemData,
                availableCountries: availableCountries,
                createTime: Math.floor(Date.now() / 1000)
            };
            localStorage.setItem(localStorageKey, JSON.stringify(cachedData));
        }

        expressCheckoutApi.availableCountries = cachedData.availableCountries;
        expressCheckoutApi.paymentSystemInitialData = {
            currencyFromSession: cachedData.paymentSystemData.currencyFromSession,
            currencySign: cachedData.paymentSystemData.currencySign,
            freeShippingLabel: cachedData.paymentSystemData.freeShippingLabel,
            mid: cachedData.paymentSystemData.mid,
            label: cachedData.paymentSystemData.label
        };

        expressCheckoutApi.firstDeliveryContactChange = true;
        expressCheckoutApi.setDefaultDeliverie();
        const defaultDelivieries = expressCheckoutApi.getAvailableDeliveriesForGooglePay(expressCheckoutApi.deliveries);
        return {
            defaultShippingOptions: defaultDelivieries,
            shippingAddressParameters: expressCheckoutApi.getGoogleShippingAddressParameters(),
            transactionDetails: {
                currencyCode: expressCheckoutApi.paymentSystemInitialData.currencyFromSession,
                totalPrice: 0,
                mid: expressCheckoutApi.paymentSystemInitialData.mid,
                title: expressCheckoutApi.paymentSystemInitialData.label
            }
        }
    },
    /**
     * Pobiera dostępne kraje dla Express Checkout
     *
     * @return {{allowedCountryCodes: [], phoneNumberRequired: boolean}}
     */
    getGoogleShippingAddressParameters: () => {
        const countries = [];
        const countriesResponse = expressCheckoutApi.availableCountries;
        if (countriesResponse.data.shop.countries.available) {
            countriesResponse.data.shop.countries.available.forEach((element) => {
                countries.push(element.iso.toUpperCase());
            });
        }
        if (countriesResponse.data.shop.countries.current != null ) {
            countries.push(countriesResponse.data.shop.countries.current.iso.toUpperCase());
        }

        return {
            allowedCountryCodes: countries,
            phoneNumberRequired: true
        };
    },
    /**
     * Pobiera dostępne dostawy dla Google Pay
     *
     * @param deliveriesData - dane kurierów
     *
     * @return {{defaultSelectedOptionId, shippingOptions: []}}
     */
    getAvailableDeliveriesForGooglePay: (deliveriesData) => {
        if (deliveriesData == null || deliveriesData === 'undefined' || deliveriesData.data == null || deliveriesData.data === 'undefined') {
            expressCheckoutApi.displayError();
            return;
        }
        const deliveriesShipping = deliveriesData.data.shipping.shipping;
        const deliveriesForGooglePay = [];
        for (let i = 0; i < deliveriesShipping.length; i++) {
            deliveriesForGooglePay.push({
                id: deliveriesShipping[i].courier.id.toString(),
                label: (deliveriesShipping[i].cost.value === 0 ? expressCheckoutApi.paymentSystemInitialData.freeShippingLabel : deliveriesShipping[i].cost.value.toFixed(2) + ' ' + expressCheckoutApi.paymentSystemInitialData.currencySign) +
                    ': ' + deliveriesShipping[i].courier.name,
                description: deliveriesShipping[i].courier.name
            })
        }

        return {
            defaultSelectedOptionId: deliveriesForGooglePay[0].id,
            shippingOptions: deliveriesForGooglePay
        };
    },
    /**
     * Zdarzenie zmiany danych kontaktowych/dostawy na formatce Google Pay
     *
     * @param selectedContactDelivery - wybrane/zmienione dane dostawy
     *
     * @return {Promise<{newShippingOptionParameters: {defaultSelectedOptionId, shippingOptions: *[]}, newTransactionInfo: {totalPrice: string}}>}
     */
    deliveryContactChangedGooglePay: async (selectedContactDelivery) => {
        if (expressCheckoutApi.firstDeliveryContactChange === true) {
            if (expressCheckoutApi.mode == 'product') {
                //w trybie "towar" musimy dodać tylko wybrany towar do koszyka
                await app_shop.fn.getExpressCheckoutData(expressCheckoutApi.googlePayIFrameContainer);
            }
            expressCheckoutApi.basket = await expressCheckoutApi.getBasket();
            expressCheckoutApi.firstDeliveryContactChange = false;
        }

        let countries = expressCheckoutApi.availableCountries;
        let selectedRegion = 0;
        if (typeof(countries.data) != 'undefined' && countries.data.shop.countries.available && typeof(selectedContactDelivery.shippingAddress.countryCode) != 'undefined') {
            if (selectedContactDelivery.shippingAddress.countryCode.toLowerCase() == countries.data.shop.countries.current.iso.toLowerCase()) {
                selectedRegion = countries.data.shop.countries.current.id;
            } else {
                for (var i = 0; i < countries.data.shop.countries.available.length; i++) {
                    if (countries.data.shop.countries.available[i].iso == selectedContactDelivery.shippingAddress.countryCode.toLowerCase()) {
                        //mamy wybrany region klienta dostępny w sklepie
                        selectedRegion = countries.data.shop.countries.available[i].id;
                        break;
                    }
                }
            }
        }

        //trzeba też zmieniać listę kurierów w zamówieniu i kwotę za wysyłkę
        expressCheckoutApi.deliveries = await expressCheckoutApi.getAvailableDeliveries(availableModes.basket, selectedRegion);
        let shippingMethods = expressCheckoutApi.getAvailableDeliveriesForGooglePay(expressCheckoutApi.deliveries);
        const basketWorth = expressCheckoutApi.getBasketWorth(expressCheckoutApi.basket.data.basket.summaryBasket.worth.gross.value, expressCheckoutApi.deliveries.data.shipping.shipping[0].cost.value);
        if (await expressCheckoutApi.saveSelectedCourier(expressCheckoutApi.deliveries.data.shipping.shipping[0].courier.id, expressCheckoutSystemsNames.googlePay, basketWorth, expressCheckoutApi.paymentSystemInitialData.currencyFromSession) !== 'success') {
            expressCheckoutApi.displayError();
            throw {
                errorType: 'unknown',
                message: 'Can\'t save selected deliverier'
            };
        }

        return {
            newTransactionInfo: {
                totalPrice: basketWorth.toString(),
            },
            newShippingOptionParameters: shippingMethods
        };
    },
    /**
     * Zdarzenie zmiany danych do płatności
     *
     * @param intermediatePaymentData - wybrane/zmienione dane dostawy
     *
     * @return {Promise<{data: null, error: null}|*>}
     */
    onPaymentDataChangedGooglePay: async (intermediatePaymentData) => {
        let paymentDataRequestUpdate = {
            data: null,
            error: null
        };
        try {
            if (intermediatePaymentData.shippingAddress == null || intermediatePaymentData.callbackTrigger === "SHIPPING_OPTION") {
                try {
                    const totalPrice = await expressCheckoutApi.deliveryChanged(intermediatePaymentData.shippingOptionData.id, expressCheckoutSystemsNames.googlePay);
                    paymentDataRequestUpdate.data = {
                        newTransactionInfo: {
                            totalPrice: totalPrice.toString()
                        }
                    };
                } catch (error) {
                    if (error.type === 'selectedDeliveryInvalid') {
                        paymentDataRequestUpdate.error = {
                            reason: 'SHIPPING_OPTION_INVALID',
                            intent: 'SHIPPING_OPTION',
                            message: error.message
                        };
                    } else {
                        paymentDataRequestUpdate.error = {
                            reason: 'OTHER_ERROR',
                            intent: 'SHIPPING_OPTION',
                            message: error.message
                        };
                    }

                    throw paymentDataRequestUpdate;
                }
            } else {
                try {
                    paymentDataRequestUpdate.data = await expressCheckoutApi.deliveryContactChangedGooglePay(intermediatePaymentData);
                } catch (error) {
                    paymentDataRequestUpdate.error = {
                        reason: 'OTHER_ERROR',
                        intent: 'SHIPPING_ADDRESS',
                        message: error.message
                    };

                    throw paymentDataRequestUpdate;
                }
            }

            return paymentDataRequestUpdate;
        } catch (error) {
            return error;
        }
    },
    /**
     * Proceduje token płatności Apple Pay
     *
     * @param paymentToken - token płatniczy
     * @return
     */
    proceedPaymentGooglePay: async (paymentToken) => {
        let url = '';

        localStorage.setItem('googlePayToken', JSON.stringify(paymentToken.paymentMethodData.tokenizationData.token));
        let proceeded = await expressCheckoutApi.proceedPayment(
            expressCheckoutSystemsNames.googlePay,
            '',
            expressCheckoutApi.b64EncodeUnicode(JSON.stringify(paymentToken))
        );
        if (typeof(proceeded.data) != 'undefined') {
            url = proceeded.data;
        }

        let state = '';

        if (typeof(url) == 'string' && url !== '') {
            state = 'SUCCESS';
        } else {
            expressCheckoutApi.displayError();
            state = 'ERROR';
        }

        return {
            url: url,
            status: {
                transactionState: state
            }
        }
    },
    /**
     * Proceduje płatność
     *
     * @param system    - system płatności
     * @param orderId   - identyfikator zamówienia w zew. COP
     * @param token     - token płatniczy
     * @return {Promise<*|boolean>}
     */
    proceedPayment: async(system, orderId, token) => {
        let fetchDataQuery = JSON.stringify({
            query: `mutation{
              expressCheckoutProceedPayment(ProceedPaymentInput: {
                system:"${system}"
                orderId:"${orderId}"
                token:"${token}"
              }){
                status
                data
              }
            }`
        });
        let ret = await expressCheckoutApi.fetchData(fetchDataQuery);

        return ret.data.expressCheckoutProceedPayment;
    },
    /**
     * Akceptuje płatność (księguje)
     *
     * @param system - system płatności
     * @param data   - dane do zaksięgowania płatności
     * @return {Promise<void>}
     */
    acceptPayment: async(system, data) => {
        orderdetails_payments.ajaxLoadSite(0);
        expressCheckoutApi.addLoaderWithCustomText('Loading');

        if (system === expressCheckoutSystemsNames.payPal) {
            await expressCheckoutApi.acceptPaymentPayPal(data);
        }
        if (system === expressCheckoutSystemsNames.applePay) {
            await expressCheckoutApi.acceptPaymentApplePay(data);
        }
        if (system === expressCheckoutSystemsNames.googlePay) {
            await expressCheckoutApi.acceptPaymentGooglePay(data);
        }
        // gasimy loader tylko w systemach, które nie wymagają przeładowania strony.
        // W innym wypadku podczas ładowania przekierowania zniknie nam loader.
        // expressCheckoutApi.removeLoaderWithCustomText();

    },
    /**
     * Akceptuje płatność (księguje) Apple Pay
     *
     * @param data - dane do zaksięgowania płatności
     * @return {Promise<boolean>}
     */
    acceptPaymentApplePay: async(data) => {
        try {
            const response = await fetch("order-payment.php", {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "X-Correlation-ID": data.xCorrelationId
                },
                body: data.postData,
            });
            const initData = await response.json();

            let applePayToken = localStorage.getItem('applePayToken');
            applePayToken = JSON.parse(applePayToken);
            if (applePayToken == null || applePayToken == false) {
                window.location.href = data.paymentErrorUrl;
            }

            const paymentData = {
                finalizePaymentToken: initData.finalizePaymentToken,
                applePaymentToken: applePayToken,
                xCorrelationId: data.xCorrelationId,
                paymentSuccessUrl: data.paymentSuccessUrl,
                paymentErrorUrl: data.paymentErrorUrl,
                paymentPendingUrl: data.paymentPendingUrl,

            }

            await acceptPayment(paymentData);

        } catch (error) {
            window.location.href = data.paymentErrorUrl;
        }
    },
    /**
     * Dodaje iFrame do strony
     *
     * @param iFrame
     */
    addiFrameToSite: async (iFrame) => {
        document.body.appendChild(iFrame);
        return new Promise((res, rej) => {
            iFrame.onload = () => {
                res();
            }
        });
    },
    /**
     * Akceptuje płatność (księguje) Apple Pay
     *
     * @param data - dane do zaksięgowania płatności
     * @return {Promise<boolean>}
     */
    acceptPaymentGooglePay: async(data) => {
        try {
            const response = await fetch("order-payment.php", {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "X-Correlation-ID": data.xCorrelationId
                },
                body: data.postData,
            });
            const initData = await response.json();
            let googlePayToken = localStorage.getItem('googlePayToken');
            googlePayToken = JSON.parse(googlePayToken);
            if (googlePayToken == null || googlePayToken == false) {
                window.location.href = data.paymentErrorUrl;
            }

            const paymentData = {
                finalizePaymentToken: initData.finalizePaymentToken,
                googlePaymentToken: googlePayToken,
                xCorrelationId: data.xCorrelationId
            }

            const googlePayIFrame = document.createElement('iframe');
            googlePayIFrame.src ='https://payment.idosell.com/assets/html/googlePay.html?expressCheckout=yes&finalizeExpressCheckout=yes&FFFixed=yes&origin=' + encodeURIComponent(expressCheckoutApi.getLocationDomain());
            googlePayIFrame.allowPaymentRequest = true;
            await expressCheckoutApi.addiFrameToSite(googlePayIFrame);
            const resultData = await expressCheckoutApi.requestGooglePayJSApi('acceptPayment', paymentData, googlePayIFrame);
            switch (resultData.status) {
                case '3ds_required':
                    const _3dsData = JSON.parse(resultData._3dsData);
                    var form = document.createElement('form');
                    document.body.appendChild(form);
                    form.method = 'post';
                    form.action = _3dsData["3dsUrl"];
                    for (var name in _3dsData["3dsDetails"]) {
                        if (!_3dsData["3dsDetails"].hasOwnProperty(name)) { continue; }
                        var input = document.createElement('input');
                        input.type = 'hidden';
                        input.name = name;
                        input.value = _3dsData["3dsDetails"][name];
                        form.appendChild(input);
                    }
                    form.submit();
                    break;
                case 'rejected':
                    window.location.href = data.paymentErrorUrl;
                    break;
                case 'pending':
                default:
                    window.location.href = data.paymentPendingUrl;
            }
        } catch (error) {
            window.location.href = data.paymentErrorUrl;
        }
    },
    /**
     * Akceptuje płatność (księguje) Apple Pay
     *
     * @param data - dane do zaksięgowania płatności
     * @return {Promise<boolean>}
     */
    acceptPaymentPayPal: async(data) => {

    },
    /**
     * Ustawia region w sesji
     *
     * @param region
     * @return {Promise<*|boolean>}
     */
    setRegion: async(region) => {
        let fetchDataQuery = JSON.stringify(
            {
                query: `mutation{
                  editCurrentSettings(ShopSettingsInput: {
                    countryId:"${region}"
                  }){
                    status
                  }
                }`,
            }
        );
        let ret = await expressCheckoutApi.fetchData(fetchDataQuery);

        return ret;
    },
    /**
     * Robi przekierowanie
     *
     * @param url - adres
     */
    redirectOrder: (url) => {
        if (typeof(url) == 'string' && url !== '') {
            window.location.replace(url);
        } else {
            expressCheckoutApi.displayError();
        }
    },
    /**
     * Wyświetla błąd płatności
     */
    displayError: () => {
        if (typeof(Alertek) === 'object') {
            Alertek.Start("Payment error", '--error');
        }
    },
    setBasket: async(serializeForm) => {
        if (typeof(serializeForm) == 'undefined') {
            expressCheckoutApi.displayError();
            return false;
        }
        let basketPart = '';
        const serializeFormKeys = Array.from(serializeForm.keys());
        if (serializeFormKeys.find((el) => el === 'product[1]')) {
            basketPart += '?type=multiproduct';
        }
        let formData = serializeForm;
        formData += '&expressCheckout=1';
        try {
            const response = await fetch('/basketchange.php' + basketPart, {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: formData,
            });
            const dataJson = await response.json();

            return dataJson;
        } catch (error) {
            console.error('AJAX setBasket() Error:', error);
            expressCheckoutApi.displayError();
            throw error;
        }
    },
    setDefaultDeliverie: () => {
        expressCheckoutApi.deliveries = {
            data: {
                shipping: {
                    shipping: [
                        {
                            courier: {
                                id: 1,
                                name: '...'
                            },
                            cost: {
                                value: 0
                            }
                        }
                    ]
                }
            }
        };
    },
    /**
     * Koduje stringa do base64
     *
     * @param str
     *
     * @return {string}
     */
    b64EncodeUnicode: (str) => {
        return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function(match, p1) {
            return String.fromCharCode('0x' + p1);
        }));
    },
    /**
     * Pobiera domenę witryny
     * 
     * @return {string}
     */
    getLocationDomain: () => {
        const url = window.location;
        const urlObject = (new URL(url));

        return urlObject.origin;
    },
    addLoaderWithCustomText: (text) => {
        document.body.classList.add('load-content');
        const customTextLoader = document.createElement('span');
        customTextLoader.classList.add('load-content-message');
        customTextLoader.textContent = text;
        customTextLoader.setAttribute('style', 'position:fixed;top:calc(50% + 20px);left:50%;transform:translateX(-50%);opacity:1;z-index:2;font-size:11px;');
        document.body.appendChild(customTextLoader);
    },
    removeLoaderWithCustomText: () => {
        document.body.classList.remove('load-content');
        const customTextLoader = document.querySelector('.load-content-message');
        if (customTextLoader) customTextLoader.parentNode.removeChild(customTextLoader);
    },
    getCookie: (cookieName) => {
        let cookieValue = '0';
        document.cookie.split(';').every(el => {
            let [key,value] = el.split('=');
            if (cookieName === key.trim()) {
                cookieValue = value;
                return false;
            }
            return true;
        });

        return cookieValue;
    }
}
