namespace UniDipVeri.Application.Features.Auth.Models;

public record ResetPasswordRequest(string Email);

public record ConfirmResetPasswordRequest(string Token, string NewPassword);

public record ChangePasswordRequest(string CurrentPassword, string NewPassword);

public record UserProfileResponse(
    Guid Id,
    string Email,
    string Name,
    string Role,
    IReadOnlyList<string> Roles,
    string UserType,
    string? StudentNumber,
    string Institution);
