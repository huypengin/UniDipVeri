using Microsoft.AspNetCore.Mvc;

namespace UniDipVeri.WebApi.Extensions;

public static class ControllerExtensions
{
    public static IActionResult MapErrorResult(this ControllerBase controller, Enum errorType, string? error)
    {
        var message = error ?? "An error occurred.";
        return errorType.ToString() switch
        {
            "NotFound" => controller.NotFound(new { message }),
            "Conflict" => controller.Conflict(new { message }),
            "Validation" or "PolicyViolation" => controller.BadRequest(new { message }),
            _ => controller.BadRequest(new { message })
        };
    }
}
