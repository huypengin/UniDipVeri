using System.Diagnostics.CodeAnalysis;

namespace UniDipVeri.Application.Features.Auth.Models;

public sealed record LoginRequest
{
    public string Email { get; init; } = string.Empty;
    public string Password { get; init; } = string.Empty;

    public LoginRequest() { }

    public LoginRequest(string email, string password)
    {
        Email = email;
        Password = password;
    }

    public bool IsValid => !string.IsNullOrWhiteSpace(Email) && !string.IsNullOrWhiteSpace(Password);

    public bool TryValidate([NotNullWhen(false)] out string? error)
    {
        if (string.IsNullOrWhiteSpace(Email) || string.IsNullOrWhiteSpace(Password))
        {
            error = "Invalid email or password.";
            return false;
        }

        error = null;
        return true;
    }
}
