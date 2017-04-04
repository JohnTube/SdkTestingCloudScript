const SELL_PRICE_RATIO: number = 0.75;

function SellItem_internal(soldItemInstanceId: string, requestedVcType: string) {
    var inventory = server.GetUserInventory({ PlayFabId: currentPlayerId });
    var itemInstance: PlayFabServerModels.ItemInstance = null;
    for (var i = 0; i < inventory.Inventory.length; i++) {
        if (inventory.Inventory[i].ItemInstanceId === soldItemInstanceId)
            itemInstance = inventory.Inventory[i];
    }
    if (!itemInstance) throw "Item instance not found"; // Protection against client providing incorrect data

    var catalog = server.GetCatalogItems({ CatalogVersion: itemInstance.CatalogVersion });
    var catalogItem: PlayFabServerModels.CatalogItem = null;
    for (var c = 0; c < catalog.Catalog.length; c++) {
        if (itemInstance.ItemId === catalog.Catalog[c].ItemId)
            catalogItem = catalog.Catalog[c];
    }
    if (!catalogItem) throw "Catalog Item not found"; // Title catalog consistency check (You should never remove a catalog/catalogItem if any player owns that item

    var buyPrice: number = 0;
    if (catalogItem.VirtualCurrencyPrices.hasOwnProperty(requestedVcType))
        buyPrice = catalogItem.VirtualCurrencyPrices[requestedVcType];
    if (buyPrice <= 0)
        throw "Cannot redeem this item for: " + requestedVcType; // The client requested a virtual currency which doesn't apply to this item

    // Once we get here all safety checks are passed - Perform the sell
    var sellPrice: number = Math.floor(buyPrice * SELL_PRICE_RATIO);
    server.AddUserVirtualCurrency({ PlayFabId: currentPlayerId, Amount: sellPrice, VirtualCurrency: requestedVcType });
    server.RevokeInventoryItem({ PlayFabId: currentPlayerId, ItemInstanceId: soldItemInstanceId });
}

interface ISellItemArgs {
    soldItemInstanceId: string;
    requestedVcType: string;
};
handlers.SellItem = function (args: ISellItemArgs) {
    if (!args || !args.soldItemInstanceId || !args.requestedVcType)
        throw "Invalid input parameters, expected soldItemInstanceId and requestedVcType";
    SellItem_internal(args.soldItemInstanceId, args.requestedVcType);
}

// Publisher data Examples
const PUBLISHER_USED_TITLES_KEY = "playedTitleIds";
handlers.TrackTitleUsage = function () {
    // Get the User Publisher Data for this player, and convert it into our expected format
    var getRequest: PlayFabServerModels.GetUserDataRequest = { Keys: [PUBLISHER_USED_TITLES_KEY], PlayFabId: currentPlayerId };
    var getResult: PlayFabServerModels.GetUserDataResult = server.GetUserPublisherInternalData(getRequest);
    var playedTitlesList: Array<string> = JSON.parse(getResult.Data[PUBLISHER_USED_TITLES_KEY].Value); // format is arbitrary, but this example assumes Array<string>
    if (!playedTitlesList)
        playedTitlesList = [];

    // Check if we've played this title already
    var alreadyPlayed: boolean = false;
    for (var i = 0; i < playedTitlesList.length; i++)
        alreadyPlayed = alreadyPlayed || playedTitlesList[i] === script.titleId;
    if (alreadyPlayed)
        return; // Nothing to do

    // Update the list of played titles, and re-save
    playedTitlesList.push(script.titleId);
    var setRequest: PlayFabServerModels.UpdateUserDataRequest = { PlayFabId: currentPlayerId, Data: { PUBLISHER_USED_TITLES_KEY: JSON.stringify(playedTitlesList) } };
    server.UpdateUserPublisherInternalData(setRequest);
}

const PUBLISHER_REDEEMED_TITLES_KEY = "redeemedTitleIds";
const MY_CROSS_TITLE_REWARDS: { [key: string]: number } = { "AU": 10 };
handlers.CheckCrossTitleRewards = function () {
    // Get the publisher data concerning cross-title rewards for this player
    var getRequest: PlayFabServerModels.GetUserDataRequest = { Keys: [PUBLISHER_USED_TITLES_KEY, PUBLISHER_REDEEMED_TITLES_KEY], PlayFabId: currentPlayerId };
    var getResult: PlayFabServerModels.GetUserDataResult = server.GetUserPublisherInternalData(getRequest);
    var redeemedTitleRewards: { [key: string]: Array<string> } = JSON.parse(getResult.Data[PUBLISHER_REDEEMED_TITLES_KEY].Value); // format is arbitrary, but this example assumes { [key: string]: Array<string> }
    if (!redeemedTitleRewards)
        redeemedTitleRewards = {};
    var playedTitlesList: Array<string> = JSON.parse(getResult.Data[PUBLISHER_USED_TITLES_KEY].Value); // format is arbitrary, but this example assumes Array<string>
    if (!playedTitlesList)
        playedTitlesList = [];

    // Determine which titles are un-redeemed
    var unredeemedTitleIds: Array<string> = [];
    for (var i = 0; i < playedTitlesList.length; i++) {
        if (!redeemedTitleRewards.hasOwnProperty(playedTitlesList[i]) && playedTitlesList[i] !== script.titleId)
            unredeemedTitleIds.push(playedTitlesList[i]);
    }
    if (unredeemedTitleIds.length === 0)
        return null; // Nothing to redeem

    // Give the cross title rewards
    var multiplier: number = unredeemedTitleIds.length;
    var actualRewards: { [key: string]: number } = {}; // MY_CROSS_TITLE_REWARDS is a global constant, so don't modify it or you'll mess up future calls
    for (var eachKey in MY_CROSS_TITLE_REWARDS) {
        actualRewards[eachKey] = MY_CROSS_TITLE_REWARDS[eachKey] * multiplier;
        server.AddUserVirtualCurrency({ PlayFabId: currentPlayerId, VirtualCurrency: eachKey, Amount: MY_CROSS_TITLE_REWARDS[eachKey] }); // Can only add 1 VC at a time
    }
    // Save the Publisher data indicating rewards are claimed
    redeemedTitleRewards[script.titleId] = playedTitlesList;
    var setRequest: PlayFabServerModels.UpdateUserDataRequest = { PlayFabId: currentPlayerId, Data: { PUBLISHER_REDEEMED_TITLES_KEY: JSON.stringify(redeemedTitleRewards) } };
    server.UpdateUserPublisherInternalData(setRequest);

    // Tell the client the reward
    return actualRewards;
}