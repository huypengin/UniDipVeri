using FluentAssertions;
using UniDipVeri.Application.Features.Auth.Models;

namespace UniDipVeri.Application.Tests.Models;

public class LoginRequestTests
{
    [Theory]
    [InlineData("user@miu.edu", "Password123!")]
    [InlineData("admin@miu.edu", "AdminSecret")]
    public void IsValid_ShouldReturnTrue_WhenEmailAndPasswordAreProvided(string email, string password)
    {
        var request = new LoginRequest(email, password);

        request.IsValid.Should().BeTrue();
    }

    [Theory]
    [InlineData("", "password")]
    [InlineData("   ", "password")]
    [InlineData("user@miu.edu", "")]
    [InlineData("user@miu.edu", "   ")]
    [InlineData("", "")]
    [InlineData("   ", "   ")]
    public void IsValid_ShouldReturnFalse_WhenEmailOrPasswordIsEmptyOrWhitespace(string email, string password)
    {
        var request = new LoginRequest(email, password);

        request.IsValid.Should().BeFalse();
    }

    [Fact]
    public void TryValidate_ShouldReturnTrueAndNullError_WhenRequestIsValid()
    {
        var request = new LoginRequest("user@miu.edu", "Password123!");

        var isValid = request.TryValidate(out var error);

        isValid.Should().BeTrue();
        error.Should().BeNull();
    }

    [Theory]
    [InlineData("", "password")]
    [InlineData("   ", "password")]
    [InlineData("user@miu.edu", "")]
    [InlineData("user@miu.edu", "   ")]
    [InlineData("", "")]
    public void TryValidate_ShouldReturnFalseAndErrorMessage_WhenRequestIsInvalid(string email, string password)
    {
        var request = new LoginRequest(email, password);

        var isValid = request.TryValidate(out var error);

        isValid.Should().BeFalse();
        error.Should().Be("Invalid email or password.");
    }
}
